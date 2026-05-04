# Battle With Friend — Vite.js Implementation Guide
> Dokumentasi teknikal untuk senior game programmer  
> Stack: **Vite + Vanilla JS + Matter.js (Physics Engine)**

---

## 📐 1. Gambaran Arsitektur

Game ini adalah **2D physics-based battle game** yang berjalan di `<canvas>`. Tidak ada framework UI — murni canvas rendering + physics engine.

```
project/
├── index.html
├── main.js              ← entry point Vite
├── src/
│   ├── Game.js          ← game loop, state manager
│   ├── Arena.js         ← boundary colliders
│   ├── Player.js        ← circle rigid body + knife attachment
│   ├── Physics.js       ← Matter.js world setup
│   ├── Renderer.js      ← canvas draw calls
│   └── HUD.js           ← HP display, VS text, header
└── assets/
    └── knife.png        ← sprite pisau
```

**Dependencies:**
```bash
npm create vite@latest battle-game -- --template vanilla
cd battle-game
npm install matter-js
```

---

## 🌍 2. Physics World Setup (`Physics.js`)

Gunakan **Matter.js** sebagai physics engine. Ini yang paling tepat untuk kasus ini karena support circle rigid body, gravity, restitution, dan angular velocity secara native.

```js
// src/Physics.js
import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Events, Runner } = Matter;

export function createPhysicsWorld() {
  const engine = Engine.create({
    gravity: { x: 0, y: 1.2 }  // gravity normal ke bawah
    // y: 1.2 → cukup berat agar bola terasa "berbobot"
    // tapi tidak terlalu cepat jatuh sehingga game masih fun
  });

  return { engine, world: engine.world };
}
```

**Kenapa gravity y: 1.2?**  
Dari video terlihat bola tidak melayang bebas, ada tarikan ke bawah yang natural. Bola memantul dari lantai dan dinding dengan "weight" yang terasa.

---

## 🏟️ 3. Arena: Static Boundary Colliders (`Arena.js`)

Arena adalah kotak statis — 4 edge collider yang membentuk dinding, lantai, dan langit-langit.

```js
// src/Arena.js
import Matter from 'matter-js';

const { Bodies, World } = Matter;

const WALL_OPTIONS = {
  isStatic: true,           // tidak bergerak, tidak punya mass
  restitution: 0.85,        // bouncy — bola memantul hidup dari dinding
  friction: 0.01,           // friction rendah agar angular velocity terjaga
  frictionStatic: 0.0,
  label: 'wall'
};

export function createArena(world, arenaX, arenaY, arenaW, arenaH) {
  const thickness = 20;
  const cx = arenaX + arenaW / 2;
  const cy = arenaY + arenaH / 2;

  const walls = [
    // lantai (bottom)
    Bodies.rectangle(cx, arenaY + arenaH + thickness / 2, arenaW + thickness * 2, thickness, WALL_OPTIONS),
    // langit-langit (top)
    Bodies.rectangle(cx, arenaY - thickness / 2, arenaW + thickness * 2, thickness, WALL_OPTIONS),
    // kiri (left)
    Bodies.rectangle(arenaX - thickness / 2, cy, thickness, arenaH, WALL_OPTIONS),
    // kanan (right)
    Bodies.rectangle(arenaX + arenaW + thickness / 2, cy, thickness, arenaH, WALL_OPTIONS),
  ];

  World.add(world, walls);
  return walls;
}
```

**Konfigurasi kritis:**
- `restitution: 0.85` → bola memantul hampir sempurna, tidak mati di dinding
- `friction: 0.01` → friction rendah tapi tidak nol, cukup untuk menghasilkan **sedikit** angular velocity saat rolling di lantai
- `isStatic: true` → dinding tidak terpengaruh impak bola

---

## 🔵 4. Player: Circle Rigid Body + Knife Attachment (`Player.js`)

Ini **inti dari seluruh game**. Pemahaman kunci dari kamu:

> *"Yang berputar adalah 2D circle-nya. Pisau hanya mengikuti rotasi circle sebagai child attachment — posisi pisau selalu fixed relative terhadap center circle."*

```js
// src/Player.js
import Matter from 'matter-js';

const { Bodies, World, Body } = Matter;

const CIRCLE_OPTIONS = {
  restitution: 0.9,       // sangat bouncy antar sesama circle
  friction: 0.005,        // friction sangat rendah
  frictionAir: 0.008,     // air drag — mencegah bola bergerak selamanya
  density: 0.004,         // mass circle — cukup berat untuk impak yang terasa
  label: 'player',
  // KRITIS: Matter.js secara default menghitung angular velocity
  // dari collision response. Kita tidak perlu set ini manual —
  // engine yang handle sendiri berdasarkan geometry collision.
};

export class Player {
  constructor(world, x, y, radius, playerId, avatarImg, knifeImg) {
    this.world = world;
    this.id = playerId;       // 'player1' atau 'player2'
    this.radius = radius;     // radius circle, misal: 35px
    this.hp = 10;
    this.isDead = false;
    this.hitCooldown = 0;     // cooldown ms antar damage (prevent spam)
    this.isHit = false;       // flag untuk visual feedback (bola merah)
    this.hitTimer = 0;

    // ── AVATAR IMAGE ──
    this.avatarImg = avatarImg;   // HTMLImageElement foto profil

    // ── KNIFE IMAGE ──
    this.knifeImg = knifeImg;     // HTMLImageElement sprite pisau

    // ── KNIFE LOCAL OFFSET ──
    // Pisau selalu berada di "bawah" circle dalam local space
    // Offset ini adalah jarak dari center circle ke ujung pisau
    // Dalam local space (sebelum rotation diterapkan):
    //   knifeOffset = { x: 0, y: radius + knifeLength/2 }
    // Artinya pisau "menggantung" di bawah circle
    this.knifeOffsetDistance = radius + 28; // jarak center ke center pisau
    this.knifeLocalAngle = Math.PI / 2;     // initial: menggantung ke bawah (90°)

    // ── MATTER.JS BODY ──
    this.body = Bodies.circle(x, y, radius, {
      ...CIRCLE_OPTIONS,
      collisionFilter: {
        category: playerId === 'player1' ? 0x0001 : 0x0002,
        mask: 0x0003 | 0x0004,  // collide dengan player lain dan walls
      }
    });

    World.add(world, this.body);
  }

  // ─────────────────────────────────────────────────────────────
  // KNIFE WORLD POSITION — dihitung setiap frame dari physics body
  // Ini adalah implementasi "child attachment" tanpa scene graph:
  //
  //   knifeWorld = circleCenter + rotate(knifeLocalOffset, circleAngle)
  //
  // Dimana circleAngle adalah this.body.angle dari Matter.js
  // yang diupdate secara otomatis oleh physics engine setiap tick.
  // ─────────────────────────────────────────────────────────────
  getKnifeWorldTransform() {
    const angle = this.body.angle + this.knifeLocalAngle;
    const cx = this.body.position.x;
    const cy = this.body.position.y;

    return {
      x: cx + Math.cos(angle) * this.knifeOffsetDistance,
      y: cy + Math.sin(angle) * this.knifeOffsetDistance,
      rotation: angle,  // rotasi pisau = rotasi circle + offset lokal
    };
  }

  // ─────────────────────────────────────────────────────────────
  // APPLY INITIAL IMPULSE — di awal game, beri dorongan awal
  // agar bola tidak langsung jatuh diam di lantai
  // ─────────────────────────────────────────────────────────────
  applyInitialImpulse() {
    const direction = this.id === 'player1' ? 1 : -1;
    Body.applyForce(this.body, this.body.position, {
      x: direction * 0.08,
      y: -0.15  // sedikit ke atas
    });
  }

  takeDamage() {
    if (this.hitCooldown > 0 || this.isDead) return false;

    this.hp -= 1;
    this.hitCooldown = 600;   // 600ms invincibility frames setelah kena
    this.isHit = true;
    this.hitTimer = 300;      // 300ms bola berwarna merah

    if (this.hp <= 0) {
      this.hp = 0;
      this.isDead = true;
    }

    return true;  // damage berhasil diterima
  }

  update(delta) {
    // countdown cooldowns
    if (this.hitCooldown > 0) this.hitCooldown -= delta;
    if (this.hitTimer > 0) {
      this.hitTimer -= delta;
      if (this.hitTimer <= 0) this.isHit = false;
    }

    // ── ANGULAR VELOCITY CAP ──
    // Tanpa ini, setelah banyak collision bola bisa spin terlalu kencang
    // sehingga visual pisau blur dan tidak enak dilihat
    const maxAngularVel = 0.25; // radian per tick, sesuaikan taste
    if (Math.abs(this.body.angularVelocity) > maxAngularVel) {
      Body.setAngularVelocity(
        this.body,
        Math.sign(this.body.angularVelocity) * maxAngularVel
      );
    }

    // ── SPEED CAP ──
    // Prevent bola bergerak terlalu cepat dan "menembus" dinding (tunneling)
    const vel = this.body.velocity;
    const maxSpeed = 12;
    const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2);
    if (speed > maxSpeed) {
      Body.setVelocity(this.body, {
        x: (vel.x / speed) * maxSpeed,
        y: (vel.y / speed) * maxSpeed,
      });
    }
  }

  destroy() {
    World.remove(this.world, this.body);
  }
}
```

---

## 🎨 5. Renderer: Canvas Draw Calls (`Renderer.js`)

Renderer tidak tahu tentang physics — dia hanya membaca posisi dari physics body dan menggambar.

```js
// src/Renderer.js

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  clear() {
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── ARENA ──
  drawArena(arenaX, arenaY, arenaW, arenaH) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#00FF41';   // hijau neon seperti di video
    ctx.lineWidth = 4;
    ctx.shadowColor = '#00FF41';
    ctx.shadowBlur = 10;
    ctx.strokeRect(arenaX, arenaY, arenaW, arenaH);
    ctx.shadowBlur = 0;
  }

  // ── PLAYER CIRCLE + KNIFE ──
  drawPlayer(player) {
    const ctx = this.ctx;
    const { x, y } = player.body.position;
    const angle = player.body.angle;
    const r = player.radius;

    // ── 1. GAMBAR CIRCLE ──
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);  // circle berotasi sesuai physics

    // Clip avatar ke dalam circle
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    // Fill warna berdasarkan hit state
    if (player.isHit) {
      // Saat kena damage: overlay merah
      ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }

    // Gambar avatar image (foto profil)
    if (player.avatarImg) {
      ctx.drawImage(player.avatarImg, -r, -r, r * 2, r * 2);
    }

    // Jika hit, overlay merah di atas avatar
    if (player.isHit) {
      ctx.fillStyle = 'rgba(255, 30, 30, 0.45)';
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }

    ctx.restore();

    // ── 2. GAMBAR LINGKARAN BORDER ──
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = player.isHit ? '#FF0000' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // ── 3. GAMBAR PISAU ──
    // Posisi dan rotasi pisau dihitung dari physics body angle
    const knife = player.getKnifeWorldTransform();

    ctx.save();
    ctx.translate(knife.x, knife.y);
    ctx.rotate(knife.rotation);  // sama dengan body.angle + knifeLocalAngle

    // Gambar sprite pisau centered di posisinya
    const kw = 18;   // lebar pisau
    const kh = 55;   // panjang pisau
    if (player.knifeImg) {
      ctx.drawImage(player.knifeImg, -kw / 2, -kh / 2, kw, kh);
    } else {
      // Fallback: gambar pisau dengan canvas shapes
      ctx.fillStyle = '#aaaaaa';
      ctx.fillRect(-3, -kh / 2, 6, kh * 0.7);   // blade
      ctx.fillStyle = '#8B4513';
      ctx.fillRect(-5, kh * 0.2, 10, kh * 0.3); // handle
    }

    ctx.restore();
  }

  // ── HUD: HP Numbers ──
  drawHP(player, x, y, color) {
    const ctx = this.ctx;
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = color;       // hijau untuk p1, merah untuk p2
    ctx.textAlign = 'center';
    ctx.fillText(player.hp.toString(), x, y);
  }
}
```

---

## 💥 6. Collision Detection & Damage System (`Game.js`)

Damage terjadi dari **collision antar dua circle player** — bukan dari knife sprite menyentuh sesuatu. Knife hanyalah visual.

```js
// src/Game.js (collision section)
import Matter from 'matter-js';

const { Events } = Matter;

setupCollisionEvents(engine, player1, player2) {
  Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;

    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;

      const isP1 = bodyA === player1.body || bodyB === player1.body;
      const isP2 = bodyA === player2.body || bodyB === player2.body;

      // Hanya proses collision antar dua player
      if (!isP1 || !isP2) continue;

      // ── HITUNG IMPACT VELOCITY ──
      // Magnitude relative velocity saat tumbukan
      const relVel = {
        x: player1.body.velocity.x - player2.body.velocity.x,
        y: player1.body.velocity.y - player2.body.velocity.y,
      };
      const impactSpeed = Math.sqrt(relVel.x ** 2 + relVel.y ** 2);

      // ── THRESHOLD: hanya deal damage jika tumbukan cukup keras ──
      // Threshold ini mencegah damage dari "bola menempel pelan"
      const DAMAGE_THRESHOLD = 2.5;
      if (impactSpeed < DAMAGE_THRESHOLD) continue;

      // ── TENTUKAN SIAPA YANG KENA ──
      // Berdasarkan arah pisau saat impact:
      // Siapapun yang "pisaunya menghadap lawan" = yang menyerang
      // Lawan = yang kena damage
      //
      // Implementasi sederhana:
      // Cek dot product antara arah pisau player dan
      // arah vektor dari player ke lawan.
      // Jika dot > 0 → pisau menghadap lawan → lawan kena damage.

      const p1KnifeDir = getKnifeDirection(player1);
      const p2ToP1 = normalize({
        x: player1.body.position.x - player2.body.position.x,
        y: player1.body.position.y - player2.body.position.y,
      });
      const p1Attacking = dot(p1KnifeDir, p2ToP1) < 0;
      // p1Attacking = true → pisau p1 mengarah ke p2 → p2 kena

      if (p1Attacking) {
        player2.takeDamage();
      } else {
        player1.takeDamage();
      }

      // ── APPLY KNOCKBACK ──
      // Setelah kena damage, beri dorongan agar bola tidak nempel
      applyKnockback(player1, player2, pair);
    }
  });
}

function getKnifeDirection(player) {
  const angle = player.body.angle + player.knifeLocalAngle;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function normalize(v) {
  const len = Math.sqrt(v.x ** 2 + v.y ** 2);
  return { x: v.x / len, y: v.y / len };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function applyKnockback(p1, p2, pair) {
  const normal = pair.collision.normal;
  const knockbackForce = 0.06;

  Matter.Body.applyForce(p1.body, p1.body.position, {
    x: -normal.x * knockbackForce,
    y: -normal.y * knockbackForce,
  });
  Matter.Body.applyForce(p2.body, p2.body.position, {
    x: normal.x * knockbackForce,
    y: normal.y * knockbackForce,
  });
}
```

---

## 🎮 7. Game Loop (`Game.js` — Main Loop)

```js
// src/Game.js
import Matter from 'matter-js';
import { createPhysicsWorld } from './Physics.js';
import { createArena } from './Arena.js';
import { Player } from './Player.js';
import { Renderer } from './Renderer.js';

const { Engine, Runner } = Matter;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);

    // ── PHYSICS ──
    const { engine, world } = createPhysicsWorld();
    this.engine = engine;
    this.world = world;

    // ── ARENA DIMENSIONS ──
    // Dari video: arena sekitar 85% lebar layar, centered
    const padding = 20;
    this.arenaX = padding;
    this.arenaY = canvas.height * 0.28;  // mulai ~28% dari atas (setelah HUD)
    this.arenaW = canvas.width - padding * 2;
    this.arenaH = canvas.height - this.arenaY - padding;

    createArena(world, this.arenaX, this.arenaY, this.arenaW, this.arenaH);

    // ── PLAYERS ──
    const r = 35;  // radius circle player
    this.player1 = new Player(
      world,
      this.arenaX + this.arenaW * 0.3,   // spawn di kiri arena
      this.arenaY + this.arenaH * 0.5,   // spawn di tengah vertikal
      r, 'player1',
      avatarImg1, knifeImg
    );

    this.player2 = new Player(
      world,
      this.arenaX + this.arenaW * 0.7,   // spawn di kanan arena
      this.arenaY + this.arenaH * 0.5,
      r, 'player2',
      avatarImg2, knifeImg
    );

    this.player1.applyInitialImpulse();
    this.player2.applyInitialImpulse();

    this.setupCollisionEvents(engine, this.player1, this.player2);

    // ── GAME STATE ──
    this.state = 'playing';  // 'playing' | 'gameover'
    this.winner = null;
    this.lastTime = 0;
  }

  start() {
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(timestamp) {
    const delta = timestamp - this.lastTime;
    this.lastTime = timestamp;

    // Update physics engine
    // fixedDelta = 1000/60 ≈ 16.67ms → physics berjalan di 60Hz
    Engine.update(this.engine, 1000 / 60);

    // Update game objects
    this.player1.update(delta);
    this.player2.update(delta);

    // Check win condition
    if (this.state === 'playing') {
      if (this.player1.isDead) {
        this.state = 'gameover';
        this.winner = 'player2';
      } else if (this.player2.isDead) {
        this.state = 'gameover';
        this.winner = 'player1';
      }
    }

    // Render
    this.render();

    if (this.state !== 'gameover') {
      requestAnimationFrame((t) => this.loop(t));
    } else {
      this.renderGameOver();
    }
  }

  render() {
    this.renderer.clear();
    this.renderer.drawArena(this.arenaX, this.arenaY, this.arenaW, this.arenaH);
    this.renderer.drawPlayer(this.player1);
    this.renderer.drawPlayer(this.player2);
    this.renderHUD();
  }

  renderHUD() {
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width;

    // Header text
    ctx.font = '14px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText('Fighting followers until I lose :day 3', w / 2, 20);

    // Avatar circles di HUD (foto profil kecil di atas)
    const hudY = 60;
    this.drawHUDAvatar(this.player1, w * 0.25, hudY, 30);
    this.drawHUDAvatar(this.player2, w * 0.75, hudY, 30);

    // VS text
    ctx.font = 'bold 28px Arial';
    ctx.fillStyle = '#FF4444';
    ctx.textAlign = 'center';
    ctx.fillText('VS', w / 2, hudY + 10);

    // HP Numbers
    this.renderer.drawHP(this.player1, w * 0.25, hudY + 50, '#00FF41');
    this.renderer.drawHP(this.player2, w * 0.75, hudY + 50, '#FF4444');
  }
}
```

---

## 🔧 8. Physics Parameter Tuning Guide

Ini parameter yang paling berpengaruh terhadap "feel" game — sesuaikan berdasarkan playtesting:

| Parameter | Value | Efek |
|---|---|---|
| `gravity.y` | `1.2` | Berat bola. Lebih tinggi = lebih cepat jatuh |
| `restitution` (circle) | `0.9` | Seberapa bouncy bola satu sama lain |
| `restitution` (wall) | `0.85` | Seberapa bouncy bola dari dinding |
| `frictionAir` | `0.008` | Drag udara — mencegah bola bergerak selamanya |
| `density` | `0.004` | Mass bola — mempengaruhi impact force |
| `maxAngularVelocity` | `0.25 rad/tick` | Cap spin agar visual pisau terbaca |
| `DAMAGE_THRESHOLD` | `2.5` | Min impact speed untuk deal damage |
| `hitCooldown` | `600ms` | Invincibility frames setelah kena |
| `knifeOffsetDistance` | `radius + 28` | Jarak pisau dari center circle |

---

## ⚡ 9. Key Physics Insight

### Mengapa Pisau "Ikut Berputar" Tanpa Logic Tambahan

```
Frame N:
  engine.update() → Matter.js menghitung collision response
                  → Mengupdate body.angle secara otomatis
                  → body.angle += angularVelocity

Frame N+1:
  renderer.drawPlayer() → baca body.angle
                        → hitung knifeWorldPos dengan:
                          angle = body.angle + knifeLocalAngle
                          knife.x = body.x + cos(angle) * offset
                          knife.y = body.y + sin(angle) * offset
                        → gambar pisau di posisi tersebut
```

**Tidak ada "knife physics" — knife tidak exist di physics world.**  
Knife hanya titik matematis yang dihitung dari transformasi circle setiap frame.  
Ini berarti:
- Zero collision cost untuk knife
- Zero constraint cost
- Perfect synchronization dengan circle karena derived langsung dari `body.angle`

### Sumber Angular Velocity

Matter.js menghasilkan angular velocity secara otomatis dari:
1. **Off-center collision** → tumbukan tidak tepat di center menghasilkan torque
2. **Wall friction** → rolling di lantai/dinding mengkonversi linear ke angular
3. **Asymmetric force** → `applyForce` di titik bukan center body

Kita tidak perlu `Body.setAngularVelocity()` manual — engine yang generate sendiri dari collision geometry.

---

## 📦 10. `index.html` Entry Point

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Battle With Friend</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="game" width="360" height="640"></canvas>
  <script type="module" src="/main.js"></script>
</body>
</html>
```

```js
// main.js
import { Game } from './src/Game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
game.start();
```

---

## ✅ Summary Checklist Implementasi

- [ ] Install `matter-js` via npm
- [ ] Setup `Engine` dengan gravity `y: 1.2`
- [ ] Buat 4 static wall bodies sebagai arena boundary
- [ ] Buat 2 circle rigid bodies untuk players (`restitution: 0.9`, `frictionAir: 0.008`)
- [ ] **Jangan buat physics body untuk pisau** — pisau adalah pure visual
- [ ] Hitung posisi pisau setiap frame dari `body.angle + knifeLocalAngle`
- [ ] Setup `collisionStart` event untuk damage detection
- [ ] Implementasi `hitCooldown` untuk prevent damage spam
- [ ] Cap `angularVelocity` dan `speed` agar tidak overflow
- [ ] Apply initial impulse di spawn agar bola langsung bergerak
- [ ] Canvas rendering dengan clip avatar ke circle shape