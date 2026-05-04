import Matter from 'matter-js';
import { createPhysicsWorld } from './Physics';
import { createArena } from './Arena';
import { Player } from './Player';
import { Renderer } from './Renderer';
import { Particle } from './Particle';
import { GAME_CONFIG } from './Config';

const { Engine, Events, Body } = Matter;

export class Game {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  engine: Matter.Engine;
  world: Matter.World;
  arenaX: number = 0;
  arenaY: number = 0;
  arenaW: number = 0;
  arenaH: number = 0;
  obstacles: Matter.Body[] = [];
  players: Player[] = [];
  assetsLoaded: boolean = false;
  state: 'playing' | 'gameover' = 'playing';
  winner: string | null = null;
  lastTime: number = 0;
  victoryTimer: number = GAME_CONFIG.VICTORY_TIMER;
  knifeImg: HTMLImageElement | null = null;
  avatarImgs: HTMLImageElement[] = [];
  tiktokUsers: Map<string, Player> = new Map();
  particles: Particle[] = [];
  shakeAmount: number = 0;
  queue: { avatarUrl: string, name: string }[] = [];
  respawnCooldowns: Map<string, number> = new Map();
  readonly MAX_PLAYERS = GAME_CONFIG.MAX_PLAYERS;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);

    const { engine, world } = createPhysicsWorld();
    this.engine = engine;
    this.world = world;

    this.initArena();

    this.loadAssets().then(({ avatarImgs, knifeImg }) => {
      this.assetsLoaded = true;
      this.avatarImgs = avatarImgs;
      this.knifeImg = knifeImg;
      
      this.setupCollisionEvents();
      this.start();
    });
  }

  initArena() {
    const padding = GAME_CONFIG.ARENA_MARGIN;
    this.arenaX = padding;
    this.arenaY = this.canvas.height * 0.15;
    this.arenaW = this.canvas.width - padding * 2;
    this.arenaH = this.canvas.height - this.arenaY - padding;

    const { obstacles } = createArena(this.world, this.arenaX, this.arenaY, this.arenaW, this.arenaH);
    this.obstacles = obstacles;
  }

  async loadAssets() {
    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = src;
        img.onload = () => resolve(img);
      });
    };

    const knifeImg = await loadImage('/knife.png');
    this.knifeImg = knifeImg;
    const avatarImgs = await Promise.all([
      loadImage('/p1.png'),
      loadImage('/p2.png'),
      loadImage('/p3.png'),
      loadImage('/p4.png'),
      loadImage('/p5.png'),
    ]);

    return { avatarImgs, knifeImg };
  }

  // ── TIKTOK HANDLERS ──
  onTikTokChat(data: any) {
    const userId = data.uniqueId;
    const existingPlayer = this.tiktokUsers.get(userId);

    if (existingPlayer) {
      if (!existingPlayer.isDead) {
        const force = GAME_CONFIG.CHAT_BOOST_FORCE;
        const angle = Math.random() * Math.PI * 2;
        Body.applyForce(existingPlayer.body, existingPlayer.body.position, {
          x: Math.cos(angle) * force,
          y: Math.sin(angle) * force
        });
      }
    } else {
      // Check cooldown
      const cooldown = this.respawnCooldowns.get(userId);
      if (cooldown && Date.now() < cooldown) {
        return; // Still in cooldown
      }

      if (this.players.length < this.MAX_PLAYERS) {
        this.spawnNewPlayer(data.profilePictureUrl, userId);
      } else {
        if (!this.queue.some(q => q.name === userId)) {
          this.queue.push({ avatarUrl: data.profilePictureUrl, name: userId });
        }
      }
    }
  }

  onTikTokGift(data: any) {
    if (this.players.length < this.MAX_PLAYERS) {
      this.spawnNewPlayer(data.profilePictureUrl, data.uniqueId);
    } else {
      this.queue.push({ avatarUrl: data.profilePictureUrl, name: data.uniqueId });
    }
  }

  onTikTokLike(_data: any) {
    this.players.forEach(p => {
      if (!p.isDead) {
        const vel = p.body.velocity;
        Body.setVelocity(p.body, { 
          x: vel.x * GAME_CONFIG.LIKE_BOOST_MULTIPLIER, 
          y: vel.y * GAME_CONFIG.LIKE_BOOST_MULTIPLIER 
        });
      }
    });
  }

  async spawnNewPlayer(avatarUrl: string, name: string) {
    if (this.tiktokUsers.has(name) && !this.tiktokUsers.get(name)?.isDead) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = avatarUrl;
    
    // Add 3s timeout for image loading
    await Promise.race([
      new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      }),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);

    const r = GAME_CONFIG.PLAYER_RADIUS;
    const x = this.arenaX + Math.random() * this.arenaW;
    const y = this.arenaY + Math.random() * this.arenaH;
    
    const avatarToUse = img.complete ? img : this.avatarImgs[Math.floor(Math.random() * this.avatarImgs.length)];

    const newPlayer = new Player(
      this.world,
      x, y, r,
      name.substring(0, 8),
      avatarToUse,
      this.knifeImg
    );
    newPlayer.tiktokProfileImg = img.complete ? img : null;
    
    newPlayer.applyInitialImpulse();
    this.players.push(newPlayer);
    this.tiktokUsers.set(name, newPlayer);
  }

  setupCollisionEvents() {
    Events.on(this.engine, 'collisionStart', (event) => {
      const pairs = event.pairs;

      for (const pair of pairs) {
        const { bodyA, bodyB } = pair;
        const parentA = bodyA.parent || bodyA;
        const parentB = bodyB.parent || bodyB;

        const pA = this.players.find(p => p.body === parentA);
        const pB = this.players.find(p => p.body === parentB);

        const idA = (bodyA as any).playerId;
        const idB = (bodyB as any).playerId;

        if (!idA || !idB || idA === idB) continue;

        const aIsKnife = bodyA.label === 'player-knife';
        const bIsKnife = bodyB.label === 'player-knife';
        const aIsBody = bodyA.label === 'player-body';
        const bIsBody = bodyB.label === 'player-body';

        if (aIsKnife && bIsBody && pB) {
          pB.takeDamage();
          this.createHitEffect(pair.collision.supports[0].x, pair.collision.supports[0].y, '#FF1744');
        } else if (bIsKnife && aIsBody && pA) {
          pA.takeDamage();
          this.createHitEffect(pair.collision.supports[0].x, pair.collision.supports[0].y, '#FF1744');
        }

        this.applyKnockback(pair, parentA, parentB);
      }
    });
  }

  applyKnockback(pair: Matter.Pair, parentA: Matter.Body, parentB: Matter.Body) {
    const normal = pair.collision.normal;
    const knockbackForce = GAME_CONFIG.KNOCKBACK_FORCE;

    Body.applyForce(parentA, parentA.position, {
      x: -normal.x * knockbackForce,
      y: -normal.y * knockbackForce,
    });
    Body.applyForce(parentB, parentB.position, {
      x: normal.x * knockbackForce,
      y: normal.y * knockbackForce,
    });
  }

  start() {
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(timestamp: number) {
    const delta = timestamp - this.lastTime;
    this.lastTime = timestamp;

    Engine.update(this.engine, 1000 / 60);

    // ── ELIMINATION & QUEUE REPLACEMENT ──
    const deadPlayers = this.players.filter(p => p.isDead);
    if (deadPlayers.length > 0) {
      deadPlayers.forEach(p => {
        p.destroy();
        this.tiktokUsers.delete(p.id);
        // Set respawn cooldown from config
        this.respawnCooldowns.set(p.id, Date.now() + GAME_CONFIG.RESPAWN_COOLDOWN);
      });
      this.players = this.players.filter(p => !p.isDead);
    }

    // Spawn from queue if space available
    while (this.players.length < this.MAX_PLAYERS && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.spawnNewPlayer(next.avatarUrl, next.name);
      }
    }

    const alivePlayers = this.players.filter(p => !p.isDead);

    for (const player of alivePlayers) {
      let nearestOpponent: Player | null = null;
      let minDist = Infinity;

      for (const other of alivePlayers) {
        if (other === player) continue;
        const dx = other.body.position.x - player.body.position.x;
        const dy = other.body.position.y - player.body.position.y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          nearestOpponent = other;
        }
      }

      player.update(delta, nearestOpponent?.body);

      // ── CONTAINMENT SAFETY ──
      const margin = GAME_CONFIG.ARENA_MARGIN;
      const px = player.body.position.x;
      const py = player.body.position.y;
      
      let pushX = 0;
      let pushY = 0;

      if (px < this.arenaX - margin) pushX = 1;
      if (px > this.arenaX + this.arenaW + margin) pushX = -1;
      if (py < this.arenaY - margin) pushY = 1;
      if (py > this.arenaY + this.arenaH + margin) pushY = -1;

      if (pushX !== 0 || pushY !== 0) {
        Body.setVelocity(player.body, { x: player.body.velocity.x * 0.5 + pushX * 5, y: player.body.velocity.y * 0.5 + pushY * 5 });
        Body.setPosition(player.body, {
          x: Math.max(this.arenaX, Math.min(this.arenaX + this.arenaW, px)),
          y: Math.max(this.arenaY, Math.min(this.arenaY + this.arenaH, py))
        });
      }
    }

    if (this.state === 'playing') {
      if (alivePlayers.length === 1 && this.players.length >= 1) {
        this.victoryTimer -= delta;
        if (this.victoryTimer <= 0) {
          this.state = 'gameover';
          this.winner = alivePlayers[0].id;
        }
      } else if (alivePlayers.length > 1) {
        this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
      }
    }

    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => p.update());

    this.shakeAmount *= 0.9;
    if (this.shakeAmount < 0.1) this.shakeAmount = 0;

    this.render();

    if (this.state !== 'gameover') {
      requestAnimationFrame((t) => this.loop(t));
    }
  }

  render() {
    if (!this.assetsLoaded) return;
    const ctx = this.renderer.ctx;
    
    ctx.save();
    if (this.shakeAmount > 0) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmount, (Math.random() - 0.5) * this.shakeAmount);
    }

    this.renderer.clear();
    this.renderer.drawArena(this.arenaX, this.arenaY, this.arenaW, this.arenaH);
    
    for (const obstacle of this.obstacles) {
      this.renderer.drawObstacle(obstacle);
    }
    
    for (const player of this.players) {
      if (!player.isDead) {
        this.renderer.drawPlayer(player);
      }
    }

    for (const p of this.particles) {
      p.draw(ctx);
    }
    
    ctx.restore();
    this.renderHUD();
  }

  createHitEffect(x: number, y: number, color: string) {
    this.shakeAmount = GAME_CONFIG.SHAKE_INTENSITY;
    for (let i = 0; i < 15; i++) {
      this.particles.push(new Particle(x, y, color));
    }
  }

  renderHUD() {
    const ctx = this.renderer.ctx;
    const w = this.canvas.width;

    ctx.font = 'bold 16px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.fillText('BATTLE ROYALE: LAST ONE STANDING', w / 2, 25);

    if (this.queue.length > 0) {
      ctx.font = '14px Arial';
      ctx.fillStyle = '#FFD600';
      ctx.fillText(`QUEUE: ${this.queue.length} WAITING`, w / 2, 45);
    }

    const hudY = 50;
    const iconSize = GAME_CONFIG.HUD_ICON_SIZE;
    const itemsPerRow = GAME_CONFIG.HUD_ITEMS_PER_ROW;
    const rowHeight = GAME_CONFIG.HUD_ROW_HEIGHT;
    
    this.players.forEach((player, i) => {
      const row = Math.floor(i / itemsPerRow);
      const col = i % itemsPerRow;
      const x = (w / itemsPerRow) * (col + 0.5);
      const y = hudY + row * rowHeight;
      const color = player.isDead ? '#555555' : this.getPlayerColor(i);
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, iconSize / 2, 0, Math.PI * 2);
      ctx.clip();
      if (player.tiktokProfileImg) {
        ctx.drawImage(player.tiktokProfileImg, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
      } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
      }
      if (player.isDead) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(x, y, iconSize / 2, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = 'white';
      ctx.fillText(player.isDead ? '☠' : Math.ceil(player.hp).toString(), x, y + iconSize / 2 + 15);
      
      ctx.font = '10px Arial';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(player.id, x, y + iconSize / 2 + 28);
    });

    const aliveCount = this.players.filter(p => !p.isDead).length;
    if (this.state === 'playing' && aliveCount === 1 && this.players.length > 1) {
      ctx.font = 'bold 32px Arial';
      ctx.fillStyle = '#FFD600';
      ctx.fillText(`VICTORY IN: ${(this.victoryTimer / 1000).toFixed(1)}s`, w / 2, this.canvas.height / 2);
    }
    
    if (this.state === 'gameover') {
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = 'white';
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 10;
      ctx.fillText('GAME OVER', w / 2, this.canvas.height / 2);
      ctx.font = 'bold 24px Arial';
      ctx.fillText(`WINNER: ${this.winner?.toUpperCase()}`, w / 2, this.canvas.height / 2 + 50);
      ctx.shadowBlur = 0;
    }
  }

  getPlayerColor(index: number) {
    const colors = ['#00E5FF', '#FF1744', '#00E676', '#D1C4E9', '#FFD600'];
    return colors[index % colors.length];
  }
}
