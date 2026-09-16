/* ============================================================
   FIST & FATHOM — a small top-down dungeon crawler
   Everything is drawn on one canvas; no assets, no libraries.
   ============================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VW = canvas.width, VH = canvas.height;

const TILE = 32;
const MAPW = 46, MAPH = 34;

const WALL = 0, FLOOR = 1, STAIRS = 2;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[randInt(0, arr.length - 1)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------------------------------------
   Input
   ------------------------------------------------------------ */
const keys = Object.create(null);
addEventListener('keydown', e => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const held = names => names.some(n => keys[n]);

/* ------------------------------------------------------------
   Game state
   ------------------------------------------------------------ */
const game = {
  scene: 'title',      // title | play | shop | dead
  floor: 1,
  coins: 0,
  earned: 0,
  kills: 0,
  time: 0,
  shake: 0,
  map: null,
  rooms: [],
  enemies: [],
  pickups: [],
  particles: [],
  floaters: [],
  hits: [],            // active punch hitboxes
  cam: { x: 0, y: 0 },
  stairs: { x: 0, y: 0 },
  cleared: false
};

const player = {
  x: 0, y: 0, r: 11,
  hp: 10, maxHp: 10,
  dx: 0, dy: 1,
  speed: 155,
  dmg: 1,
  reach: 1,
  rate: 1,
  cool: 0,
  swing: 0,
  iframes: 0,
  flash: 0,
  step: 0
};

const upgrades = { knuckles: 0, vitality: 0, boots: 0, reach: 0, hands: 0 };

/* ------------------------------------------------------------
   Dungeon generation — rooms joined by L-shaped corridors
   ------------------------------------------------------------ */
function carveRoom(map, r) {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) map[y][x] = FLOOR;
}

function carveCorridor(map, a, b) {
  const ax = Math.floor(a.x + a.w / 2), ay = Math.floor(a.y + a.h / 2);
  const bx = Math.floor(b.x + b.w / 2), by = Math.floor(b.y + b.h / 2);
  const horizFirst = Math.random() < 0.5;
  const hx = y => {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) {
      map[y][x] = FLOOR; map[y + 1][x] = FLOOR;
    }
  };
  const vy = x => {
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
      map[y][x] = FLOOR; map[y][x + 1] = FLOOR;
    }
  };
  if (horizFirst) { hx(ay); vy(bx); } else { vy(ax); hx(by); }
}

function generate(floor) {
  const map = Array.from({ length: MAPH }, () => new Array(MAPW).fill(WALL));
  const rooms = [];
  const target = clamp(5 + Math.floor(floor / 2), 5, 9);

  let guard = 0;
  while (rooms.length < target && guard++ < 500) {
    const w = randInt(6, 11), h = randInt(5, 9);
    const r = { x: randInt(2, MAPW - w - 3), y: randInt(2, MAPH - h - 3), w, h };
    const pad = 2;
    const clash = rooms.some(o =>
      r.x - pad < o.x + o.w && r.x + r.w + pad > o.x &&
      r.y - pad < o.y + o.h && r.y + r.h + pad > o.y);
    if (clash) continue;
    rooms.push(r);
  }

  rooms.forEach(r => carveRoom(map, r));
  for (let i = 1; i < rooms.length; i++) carveCorridor(map, rooms[i - 1], rooms[i]);
  // one extra link so the layout isn't a pure line
  if (rooms.length > 3) carveCorridor(map, rooms[0], rooms[rooms.length - 1]);

  return { map, rooms };
}

const solid = (tx, ty) =>
  tx < 0 || ty < 0 || tx >= MAPW || ty >= MAPH || game.map[ty][tx] === WALL;

const centerOf = r => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

/* ------------------------------------------------------------
   Enemies
   ------------------------------------------------------------ */
const KINDS = {
  slime:  { hp: 3,  speed: 42,  dmg: 1, r: 11, coin: 3,  color: '#6fd06f', dark: '#2f7a37', touch: 0.9 },
  bat:    { hp: 2,  speed: 105, dmg: 1, r: 9,  coin: 4,  color: '#b58cf0', dark: '#5b3d92', touch: 0.7 },
  brute:  { hp: 8,  speed: 55,  dmg: 2, r: 15, coin: 9,  color: '#e0854a', dark: '#8a4520', touch: 1.1 },
  wisp:   { hp: 4,  speed: 78,  dmg: 2, r: 10, coin: 7,  color: '#63c8e8', dark: '#276a86', touch: 0.8 },
  warden: { hp: 40, speed: 62,  dmg: 3, r: 22, coin: 60, color: '#d2413a', dark: '#6d1a17', touch: 1.2, boss: true }
};

function spawnEnemy(kind, x, y, floor) {
  const k = KINDS[kind];
  const scale = 1 + (floor - 1) * 0.18;
  game.enemies.push({
    kind, x, y, r: k.r,
    hp: Math.round(k.hp * scale), maxHp: Math.round(k.hp * scale),
    speed: k.speed * (1 + (floor - 1) * 0.02),
    dmg: k.dmg + Math.floor((floor - 1) / 4),
    coin: k.coin, boss: !!k.boss,
    touchCd: 0, flash: 0, knock: { x: 0, y: 0 },
    wob: Math.random() * 6.28, dead: false
  });
}

function populate(floor) {
  const pool = ['slime', 'slime', 'bat'];
  if (floor >= 2) pool.push('bat', 'brute');
  if (floor >= 4) pool.push('wisp', 'brute');
  if (floor >= 6) pool.push('wisp', 'wisp');

  const count = clamp(4 + floor * 2, 4, 22);
  const spots = game.rooms.slice(1); // never the starting room

  for (let i = 0; i < count; i++) {
    const r = pick(spots);
    const x = rand((r.x + 1) * TILE, (r.x + r.w - 1) * TILE);
    const y = rand((r.y + 1) * TILE, (r.y + r.h - 1) * TILE);
    spawnEnemy(pick(pool), x, y, floor);
  }
  if (floor % 5 === 0) {
    const c = centerOf(game.rooms[game.rooms.length - 1]);
    spawnEnemy('warden', c.x, c.y, floor);
  }
}

/* ------------------------------------------------------------
   Floor setup
   ------------------------------------------------------------ */
function buildFloor() {
  const { map, rooms } = generate(game.floor);
  game.map = map;
  game.rooms = rooms;
  game.enemies = [];
  game.pickups = [];
  game.particles = [];
  game.floaters = [];
  game.hits = [];
  game.cleared = false;

  const start = centerOf(rooms[0]);
  player.x = start.x; player.y = start.y;
  player.iframes = 1.0;

  // stairs sit in the room farthest from the player
  let best = rooms[1] || rooms[0], bestD = -1;
  for (const r of rooms.slice(1)) {
    const c = centerOf(r);
    const d = Math.hypot(c.x - start.x, c.y - start.y);
    if (d > bestD) { bestD = d; best = r; }
  }
  const sc = centerOf(best);
  game.stairs = { x: sc.x, y: sc.y };
  map[Math.floor(sc.y / TILE)][Math.floor(sc.x / TILE)] = STAIRS;

  populate(game.floor);
  toast(game.floor % 5 === 0
    ? 'FLOOR ' + game.floor + ' — something large breathes here'
    : 'FLOOR ' + game.floor);
}

/* ------------------------------------------------------------
   Effects
   ------------------------------------------------------------ */
function burst(x, y, color, n = 8, power = 150) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(power * 0.3, power);
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(0.2, 0.5), max: 0.5, color, size: rand(2, 5)
    });
  }
}

function floater(x, y, text, color) {
  game.floaters.push({ x, y, text, color, life: 0.8 });
}

let toastTimer = 0;
const toastEl = document.getElementById('toast');
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.animation = 'none';
  void toastEl.offsetWidth;
  toastEl.style.animation = '';
  toastTimer = 2.2;
}

/* ------------------------------------------------------------
   Movement & collision (circle vs. tile grid)
   ------------------------------------------------------------ */
/* Entities collide as axis-aligned boxes of half-size `r`. Each axis is
   resolved on its own, which is what lets you slide along a wall instead of
   catching on its corners. */
const EPS = 0.01;

function moveEntity(e, dx, dy) {
  if (dx) {
    e.x += dx;
    const top = Math.floor((e.y - e.r) / TILE);
    const bot = Math.floor((e.y + e.r - EPS) / TILE);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.r) / TILE);
      for (let y = top; y <= bot; y++)
        if (solid(tx, y)) { e.x = tx * TILE - e.r - EPS; break; }
    } else {
      const tx = Math.floor((e.x - e.r) / TILE);
      for (let y = top; y <= bot; y++)
        if (solid(tx, y)) { e.x = (tx + 1) * TILE + e.r + EPS; break; }
    }
  }

  if (dy) {
    e.y += dy;
    const left = Math.floor((e.x - e.r) / TILE);
    const right = Math.floor((e.x + e.r - EPS) / TILE);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.r) / TILE);
      for (let x = left; x <= right; x++)
        if (solid(x, ty)) { e.y = ty * TILE - e.r - EPS; break; }
    } else {
      const ty = Math.floor((e.y - e.r) / TILE);
      for (let x = left; x <= right; x++)
        if (solid(x, ty)) { e.y = (ty + 1) * TILE + e.r + EPS; break; }
    }
  }
}

/* ------------------------------------------------------------
   Player
   ------------------------------------------------------------ */
function punch() {
  const reach = 22 * player.reach;
  const size = 30 * (0.85 + player.reach * 0.2);
  game.hits.push({
    x: player.x + player.dx * reach,
    y: player.y + player.dy * reach,
    r: size / 2,
    life: 0.12,
    dmg: player.dmg,
    dx: player.dx, dy: player.dy,
    hitSet: new Set()
  });
  player.swing = 0.18;
  player.cool = 0.42 / player.rate;
  burst(player.x + player.dx * reach, player.y + player.dy * reach, '#fff6d8', 4, 90);
}

function hurtPlayer(amount) {
  if (player.iframes > 0) return;
  player.hp -= amount;
  player.iframes = 0.7;
  player.flash = 0.25;
  game.shake = Math.min(game.shake + 8, 16);
  floater(player.x, player.y - 16, '-' + amount, '#ff8a80');
  burst(player.x, player.y, '#d2413a', 10, 160);
  if (player.hp <= 0) { player.hp = 0; die(); }
}

function updatePlayer(dt) {
  let mx = 0, my = 0;
  if (held(['a', 'arrowleft'])) mx -= 1;
  if (held(['d', 'arrowright'])) mx += 1;
  if (held(['w', 'arrowup'])) my -= 1;
  if (held(['s', 'arrowdown'])) my += 1;

  if (mx || my) {
    const len = Math.hypot(mx, my);
    mx /= len; my /= len;
    player.dx = mx; player.dy = my;
    player.step += dt * 10;
    moveEntity(player, mx * player.speed * dt, my * player.speed * dt);
  } else {
    player.step = 0;
  }

  player.cool = Math.max(0, player.cool - dt);
  player.swing = Math.max(0, player.swing - dt);
  player.iframes = Math.max(0, player.iframes - dt);
  player.flash = Math.max(0, player.flash - dt);

  if (held([' ', 'j']) && player.cool === 0) punch();

  if (game.cleared && dist(player, game.stairs) < 26 && keys['e']) {
    keys['e'] = false;
    nextFloor();
  }
}

/* ------------------------------------------------------------
   Enemy AI
   ------------------------------------------------------------ */
function updateEnemies(dt) {
  for (const e of game.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    e.touchCd = Math.max(0, e.touchCd - dt);
    e.wob += dt * 6;

    const d = dist(e, player);
    let ax = 0, ay = 0;

    if (d < 380) {
      ax = (player.x - e.x) / (d || 1);
      ay = (player.y - e.y) / (d || 1);
      if (e.kind === 'bat') {              // erratic flight
        const s = Math.sin(e.wob) * 0.8;
        const t = ax;
        ax = ax * 0.7 - ay * s;
        ay = ay * 0.7 + t * s;
      }
      if (e.kind === 'wisp' && d < 70) {   // keeps its distance, then lunges
        ax *= -0.6; ay *= -0.6;
      }
    } else {
      ax = Math.cos(e.wob * 0.3) * 0.35;
      ay = Math.sin(e.wob * 0.27) * 0.35;
    }

    // keep enemies from stacking into one blob
    for (const o of game.enemies) {
      if (o === e) continue;
      const dd = dist(e, o);
      if (dd < e.r + o.r && dd > 0.01) {
        ax += (e.x - o.x) / dd * 0.9;
        ay += (e.y - o.y) / dd * 0.9;
      }
    }

    const kx = e.knock.x, ky = e.knock.y;
    e.knock.x *= Math.pow(0.0008, dt);
    e.knock.y *= Math.pow(0.0008, dt);

    moveEntity(e, (ax * e.speed + kx) * dt, (ay * e.speed + ky) * dt);

    if (d < e.r + player.r - 2 && e.touchCd === 0) {
      e.touchCd = KINDS[e.kind].touch;
      hurtPlayer(e.dmg);
    }
  }
}

function damageEnemy(e, amount, fromX, fromY) {
  e.hp -= amount;
  e.flash = 0.12;
  const a = Math.atan2(e.y - fromY, e.x - fromX);
  const k = e.boss ? 90 : 280;
  e.knock.x += Math.cos(a) * k;
  e.knock.y += Math.sin(a) * k;
  floater(e.x, e.y - e.r - 4, String(amount), '#ffe08a');
  burst(e.x, e.y, KINDS[e.kind].color, 6, 140);
  game.shake = Math.min(game.shake + 3, 12);

  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    game.kills++;
    burst(e.x, e.y, KINDS[e.kind].color, e.boss ? 40 : 14, e.boss ? 300 : 200);
    // split the full bounty across the drops without losing coins to rounding
    const drops = e.boss ? 12 : randInt(1, 3);
    const share = Math.floor(e.coin / drops);
    let extra = e.coin - share * drops;
    for (let i = 0; i < drops; i++) {
      const ang = Math.random() * 6.28, sp = rand(30, 110);
      game.pickups.push({
        x: e.x, y: e.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        value: share + (extra-- > 0 ? 1 : 0),
        life: 0, r: 6
      });
    }
    if (e.boss) { game.shake = 22; toast('THE WARDEN FALLS'); }
  }
}

function updateHits(dt) {
  for (const h of game.hits) {
    h.life -= dt;
    for (const e of game.enemies) {
      if (e.dead || h.hitSet.has(e)) continue;
      if (Math.hypot(h.x - e.x, h.y - e.y) < h.r + e.r) {
        h.hitSet.add(e);
        damageEnemy(e, h.dmg, player.x, player.y);
      }
    }
  }
  game.hits = game.hits.filter(h => h.life > 0);
}

/* ------------------------------------------------------------
   Pickups / particles
   ------------------------------------------------------------ */
function updatePickups(dt) {
  for (const p of game.pickups) {
    p.life += dt;
    const d = dist(p, player) || 1;
    if (p.life > 0.35 && d < 90) {          // magnetise toward the player
      p.vx += (player.x - p.x) / d * 900 * dt;
      p.vy += (player.y - p.y) / d * 900 * dt;
    }
    p.vx *= Math.pow(0.02, dt);
    p.vy *= Math.pow(0.02, dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (d < 16 && p.life > 0.2) {
      p.taken = true;
      game.coins += p.value;
      game.earned += p.value;
    }
  }
  game.pickups = game.pickups.filter(p => !p.taken);
}

function updateFx(dt) {
  for (const p of game.particles) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.1, dt); p.vy *= Math.pow(0.1, dt);
  }
  game.particles = game.particles.filter(p => p.life > 0);

  for (const f of game.floaters) { f.life -= dt; f.y -= 28 * dt; }
  game.floaters = game.floaters.filter(f => f.life > 0);

  game.shake = Math.max(0, game.shake - dt * 40);

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) toastEl.classList.add('hidden');
  }
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */
function camera() {
  const tx = clamp(player.x - VW / 2, 0, MAPW * TILE - VW);
  const ty = clamp(player.y - VH / 2, 0, MAPH * TILE - VH);
  game.cam.x += (tx - game.cam.x) * 0.14;
  game.cam.y += (ty - game.cam.y) * 0.14;
}

function drawMap() {
  const x0 = Math.max(0, Math.floor(game.cam.x / TILE) - 1);
  const y0 = Math.max(0, Math.floor(game.cam.y / TILE) - 1);
  const x1 = Math.min(MAPW - 1, x0 + Math.ceil(VW / TILE) + 2);
  const y1 = Math.min(MAPH - 1, y0 + Math.ceil(VH / TILE) + 2);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = game.map[y][x];
      const px = x * TILE, py = y * TILE;

      if (t === WALL) {
        // only draw walls that touch a floor tile — the rest stays black
        let edge = false;
        for (let j = -1; j <= 1 && !edge; j++) {
          for (let i = -1; i <= 1; i++) {
            const nx = x + i, ny = y + j;
            if (nx >= 0 && ny >= 0 && nx < MAPW && ny < MAPH && game.map[ny][nx] !== WALL) {
              edge = true; break;
            }
          }
        }
        if (!edge) continue;
        const shade = ((x * 7 + y * 13) % 3) * 6;
        ctx.fillStyle = 'rgb(' + (44 + shade) + ',' + (40 + shade) + ',' + (58 + shade) + ')';
        ctx.fillRect(px, py, TILE, TILE);
        if (y + 1 < MAPH && game.map[y + 1][x] !== WALL) {
          ctx.fillStyle = 'rgba(0,0,0,.45)';
          ctx.fillRect(px, py + TILE - 7, TILE, 7);
        }
        ctx.fillStyle = 'rgba(255,255,255,.045)';
        ctx.fillRect(px, py, TILE, 3);
      } else {
        const shade = ((x * 5 + y * 11) % 4) * 4;
        ctx.fillStyle = 'rgb(' + (26 + shade) + ',' + (24 + shade) + ',' + (33 + shade) + ')';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = 'rgba(0,0,0,.28)';
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        if (t === STAIRS) drawStairs(px, py);
      }
    }
  }
}

function drawStairs(px, py) {
  const open = game.cleared;
  ctx.fillStyle = open ? '#0a0a12' : '#171426';
  ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = open
      ? 'rgba(154,210,255,' + (0.16 + i * 0.16) + ')'
      : 'rgba(120,110,140,' + (0.08 + i * 0.06) + ')';
    ctx.fillRect(px + 5, py + 6 + i * 5, TILE - 10, 3);
  }
  if (open) {
    const pulse = 0.5 + Math.sin(game.time * 4) * 0.3;
    ctx.strokeStyle = 'rgba(154,210,255,' + pulse + ')';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.lineWidth = 1;
  }
}

function shadow(x, y, r) {
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.85, r * 0.9, r * 0.42, 0, 0, 6.283);
  ctx.fill();
}

function drawEnemy(e) {
  const k = KINDS[e.kind];
  shadow(e.x, e.y, e.r);
  const bob = Math.sin(e.wob) * (e.kind === 'bat' ? 3 : 1.5);

  ctx.fillStyle = e.flash > 0 ? '#fff' : k.color;
  ctx.beginPath();
  if (e.kind === 'slime') {
    const sq = 1 + Math.sin(e.wob) * 0.12;
    ctx.ellipse(e.x, e.y + bob, e.r * sq, e.r / sq, 0, 0, 6.283);
  } else if (e.kind === 'bat') {
    ctx.moveTo(e.x, e.y + bob - e.r);
    ctx.lineTo(e.x + e.r, e.y + bob + e.r * 0.7);
    ctx.lineTo(e.x - e.r, e.y + bob + e.r * 0.7);
    ctx.closePath();
  } else if (e.kind === 'brute' || e.boss) {
    ctx.rect(e.x - e.r, e.y - e.r + bob, e.r * 2, e.r * 2);
  } else {
    ctx.arc(e.x, e.y + bob, e.r, 0, 6.283);
  }
  ctx.fill();

  if (e.flash === 0) {
    ctx.strokeStyle = k.dark; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    // eyes, always tracking the player
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    const ox = Math.cos(a) * e.r * 0.32, oy = Math.sin(a) * e.r * 0.32;
    ctx.fillStyle = '#0c0a12';
    ctx.beginPath();
    ctx.arc(e.x - e.r * 0.32 + ox, e.y + bob - 2 + oy, e.r * 0.16, 0, 6.283);
    ctx.arc(e.x + e.r * 0.32 + ox, e.y + bob - 2 + oy, e.r * 0.16, 0, 6.283);
    ctx.fill();
  }

  if (e.hp < e.maxHp) {
    const w = e.r * 2.2, h = e.boss ? 5 : 3;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, h);
    ctx.fillStyle = e.boss ? '#d2413a' : '#8ede7a';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * (e.hp / e.maxHp), h);
  }
}

function drawPlayer() {
  shadow(player.x, player.y, player.r);
  const blink = player.iframes > 0 && Math.floor(game.time * 20) % 2 === 0;
  if (blink) ctx.globalAlpha = 0.45;

  const bob = Math.sin(player.step) * 1.8;

  // body
  ctx.fillStyle = player.flash > 0 ? '#fff' : '#e8e3d8';
  ctx.beginPath();
  ctx.arc(player.x, player.y + bob, player.r, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = '#3a3450'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;

  // hood, sitting opposite the facing direction
  ctx.fillStyle = '#7b4bd8';
  ctx.beginPath();
  ctx.arc(player.x - player.dx * 4, player.y + bob - player.dy * 4, player.r * 0.72, 0, 6.283);
  ctx.fill();

  // eyes
  ctx.fillStyle = '#14121c';
  ctx.beginPath();
  ctx.arc(player.x + player.dx * 5 - player.dy * 4, player.y + bob + player.dy * 5 + player.dx * 4, 1.9, 0, 6.283);
  ctx.arc(player.x + player.dx * 5 + player.dy * 4, player.y + bob + player.dy * 5 - player.dx * 4, 1.9, 0, 6.283);
  ctx.fill();

  // fist
  const ext = player.swing > 0 ? 1 - Math.abs(player.swing / 0.18 - 0.5) * 2 : 0;
  const fd = player.r + 3 + ext * 16 * player.reach;
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(player.x + player.dx * fd, player.y + bob + player.dy * fd, 5 + ext * 2.5, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = '#a8801f'; ctx.stroke();

  ctx.globalAlpha = 1;
}

function drawHits() {
  for (const h of game.hits) {
    const t = h.life / 0.12;
    ctx.strokeStyle = 'rgba(255,246,216,' + (t * 0.85) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const a = Math.atan2(h.dy, h.dx);
    ctx.arc(player.x, player.y, h.r + 14, a - 0.9, a + 0.9);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawPickups() {
  for (const p of game.pickups) {
    const b = Math.sin(game.time * 8 + p.x) * 2;
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + b - 6);
    ctx.lineTo(p.x + 4.5, p.y + b);
    ctx.lineTo(p.x, p.y + b + 6);
    ctx.lineTo(p.x - 4.5, p.y + b);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(p.x - 1.5, p.y + b - 3, 2, 3);
  }
}

function drawFx() {
  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.font = 'bold 13px ui-monospace, monospace';
  for (const f of game.floaters) {
    ctx.globalAlpha = clamp(f.life / 0.8, 0, 1);
    ctx.fillStyle = '#000';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawVignette() {
  const g = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.32, VW / 2, VH / 2, VH * 0.92);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);
}

/* A chevron pinned to the screen edge, pointing at something off-view. */
function edgeMarker(worldX, worldY, color, size) {
  const sx = worldX - game.cam.x, sy = worldY - game.cam.y;
  const m = 22;
  if (sx > m && sx < VW - m && sy > m && sy < VH - m) return false;  // already visible
  const a = Math.atan2(sy - VH / 2, sx - VW / 2);
  ctx.save();
  ctx.translate(clamp(sx, m, VW - m), clamp(sy, m, VH - m));
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, size * 0.6);
  ctx.lineTo(-size * 0.6, -size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  return true;
}

function drawPrompt() {
  ctx.textAlign = 'center';

  if (!game.cleared) {
    const left = game.enemies.length;
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,227,216,.55)';
    ctx.fillText(left + (left === 1 ? ' ENEMY REMAINS' : ' ENEMIES REMAIN'), VW / 2, VH - 26);
    // once the floor is nearly empty, point at the stragglers so the last kill
    // isn't a search party
    if (left <= 3) {
      const pulse = 0.35 + Math.sin(game.time * 5) * 0.2;
      for (const e of game.enemies) {
        edgeMarker(e.x, e.y, 'rgba(210,65,58,' + pulse + ')', 9);
      }
    }
    return;
  }

  const d = dist(player, game.stairs);
  ctx.font = '13px ui-monospace, monospace';
  if (d < 26) {
    ctx.fillStyle = '#9ad2ff';
    ctx.fillText('PRESS  E  TO DESCEND', VW / 2, VH - 26);
  } else {
    ctx.fillStyle = 'rgba(154,210,255,.6)';
    ctx.fillText('THE STAIRS ARE OPEN', VW / 2, VH - 26);
    const pulse = 0.4 + Math.sin(game.time * 5) * 0.25;
    edgeMarker(game.stairs.x, game.stairs.y, 'rgba(154,210,255,' + pulse + ')', 10);
  }
}

function render() {
  ctx.fillStyle = '#07060b';
  ctx.fillRect(0, 0, VW, VH);

  ctx.save();
  const sh = game.shake;
  ctx.translate(
    -Math.round(game.cam.x) + (sh ? rand(-sh, sh) : 0),
    -Math.round(game.cam.y) + (sh ? rand(-sh, sh) : 0)
  );

  drawMap();
  drawPickups();
  game.enemies.slice().sort((a, b) => a.y - b.y).forEach(drawEnemy);
  drawHits();
  drawPlayer();
  drawFx();
  ctx.restore();

  drawVignette();
  drawPrompt();
}

/* ------------------------------------------------------------
   HUD
   ------------------------------------------------------------ */
const el = id => document.getElementById(id);

function syncHud() {
  el('hpfill').style.width = (player.hp / player.maxHp * 100) + '%';
  el('hptext').textContent = player.hp + ' / ' + player.maxHp;
  el('s-dmg').textContent = player.dmg;
  el('s-spd').textContent = (player.speed / 155).toFixed(1);
  el('s-rch').textContent = player.reach.toFixed(1);
  el('s-rate').textContent = player.rate.toFixed(1);
  el('s-floor').textContent = game.floor;
  el('s-coins').textContent = game.coins;
}

/* ------------------------------------------------------------
   Shop
   ------------------------------------------------------------ */
const SHOP = [
  {
    id: 'knuckles', icon: '✊', name: 'IRON KNUCKLES',
    desc: 'Every punch lands harder. +1 damage.',
    base: 14, step: 10, max: 12,
    apply: () => { player.dmg += 1; }
  },
  {
    id: 'vitality', icon: '❤', name: 'OX HEART',
    desc: '+4 max HP, and a full heal on the spot.',
    base: 16, step: 11, max: 12,
    apply: () => { player.maxHp += 4; player.hp = player.maxHp; }
  },
  {
    id: 'boots', icon: '👟', name: 'SWIFT BOOTS',
    desc: 'Move 12% faster. Running is a valid tactic.',
    base: 18, step: 13, max: 6,
    apply: () => { player.speed *= 1.12; }
  },
  {
    id: 'reach', icon: '🦾', name: 'LONG ARMS',
    desc: 'Punch reaches 15% further.',
    base: 20, step: 14, max: 6,
    apply: () => { player.reach *= 1.15; }
  },
  {
    id: 'hands', icon: '⚡', name: 'QUICK HANDS',
    desc: 'Throw punches 15% faster.',
    base: 22, step: 15, max: 8,
    apply: () => { player.rate *= 1.15; }
  },
  {
    id: 'bandage', icon: '✚', name: 'BANDAGES',
    desc: 'Restore 5 HP. Buy as often as you can afford.',
    base: 8, step: 0, max: Infinity, hideLevel: true,
    apply: () => { player.hp = Math.min(player.maxHp, player.hp + 5); }
  }
];

function costOf(item) {
  const lvl = item.id === 'bandage' ? 0 : (upgrades[item.id] || 0);
  return Math.round(item.base + item.step * lvl * (1 + lvl * 0.15));
}

function renderShop() {
  el('shop-floor').textContent = game.floor;
  el('shop-coins').textContent = game.coins;

  const wrap = el('shop-items');
  wrap.innerHTML = '';

  for (const item of SHOP) {
    const lvl = upgrades[item.id] || 0;
    const maxed = lvl >= item.max;
    const cost = costOf(item);
    const full = item.id === 'bandage' && player.hp >= player.maxHp;
    const broke = maxed || full || game.coins < cost;

    const d = document.createElement('div');
    d.className = 'item' + (broke ? ' broke' : '');
    d.innerHTML =
      '<div class="icon">' + item.icon + '</div>' +
      '<div class="name">' + item.name + '</div>' +
      '<div class="desc">' + item.desc + '</div>' +
      '<div class="cost">' + (maxed ? 'MAXED' : full ? 'AT FULL HP' : '◆ ' + cost) + '</div>' +
      (item.hideLevel || maxed ? '' : '<div class="lvl">owned ' + lvl + ' / ' + item.max + '</div>');

    if (!broke) {
      d.onclick = () => {
        game.coins -= cost;
        item.apply();
        if (item.id !== 'bandage') upgrades[item.id] = lvl + 1;
        renderShop();
        syncHud();
      };
    }
    wrap.appendChild(d);
  }
}

/* ------------------------------------------------------------
   Scene flow
   ------------------------------------------------------------ */
const show = id => el(id).classList.remove('hidden');
const hide = id => el(id).classList.add('hidden');

function startRun() {
  game.floor = 1; game.coins = 0; game.earned = 0; game.kills = 0;
  player.hp = 10; player.maxHp = 10; player.dmg = 1;
  player.speed = 155; player.reach = 1; player.rate = 1;
  player.cool = 0; player.swing = 0;
  for (const k in upgrades) upgrades[k] = 0;

  buildFloor();
  game.cam.x = clamp(player.x - VW / 2, 0, MAPW * TILE - VW);
  game.cam.y = clamp(player.y - VH / 2, 0, MAPH * TILE - VH);

  hide('title'); hide('dead'); hide('shop'); show('hud');
  game.scene = 'play';
  syncHud();
}

function nextFloor() {
  game.floor++;
  game.scene = 'shop';
  hide('hud');
  renderShop();
  show('shop');
}

function die() {
  game.scene = 'dead';
  hide('hud');
  el('d-floor').textContent = game.floor;
  el('d-kills').textContent = game.kills;
  el('d-coins').textContent = game.earned;
  const record = Math.max(game.floor, +(localStorage.getItem('ff-best') || 0));
  localStorage.setItem('ff-best', record);
  show('dead');
}

el('btn-start').onclick = startRun;
el('btn-retry').onclick = startRun;
el('btn-next').onclick = () => {
  hide('shop'); show('hud');
  buildFloor();
  game.scene = 'play';
  syncHud();
};

const savedBest = localStorage.getItem('ff-best');
if (savedBest) el('best-floor').textContent = 'floor ' + savedBest;

/* ------------------------------------------------------------
   Main loop
   ------------------------------------------------------------ */
let last = performance.now();
function frame(now) {
  // clamped both ways: a backgrounded tab returns with a huge gap, and timers
  // that jump backwards would otherwise run every countdown in reverse
  const dt = clamp((now - last) / 1000, 0, 1 / 30);
  last = now;
  game.time += dt;

  if (game.scene === 'play') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateHits(dt);
    updatePickups(dt);
    updateFx(dt);

    const before = game.enemies.length;
    game.enemies = game.enemies.filter(e => !e.dead);
    if (before !== game.enemies.length && game.enemies.length === 0 && !game.cleared) {
      game.cleared = true;
      toast('THE STAIRS UNLOCK');
    }

    camera();
    render();
    syncHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
