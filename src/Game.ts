import Matter from 'matter-js';
import { createPhysicsWorld } from './Physics';
import { createArena } from './Arena';
import { Player } from './Player';
import { Renderer } from './Renderer';
import { Particle } from './Particle';
import { GAME_CONFIG } from './Config';

const { Engine, Events, Body, World } = Matter;

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
  restartTimer: number = 10000; // 10 seconds to restart
  knifeImg: HTMLImageElement | null = null;
  swordSfx: HTMLAudioElement | null = null;
  avatarImgs: HTMLImageElement[] = [];
  tiktokUsers: Map<string, Player> = new Map();
  particles: Particle[] = [];
  shakeAmount: number = 0;
  queue: { avatarUrl: string, name: string }[] = [];
  respawnCooldowns: Map<string, number> = new Map();
  readonly MAX_PLAYERS = GAME_CONFIG.MAX_PLAYERS;
  
  bgmPlaylist: string[] = ['/music.mp3', '/music1.mp3', '/music2.mp3', '/music3.mp3'];
  currentBgmIndex: number = 0;
  bgmAudio: HTMLAudioElement | null = null;
  lastSfxTime: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);

    const { engine, world } = createPhysicsWorld();
    this.engine = engine;
    this.world = world;

    this.initArena();

    this.loadAssets().then(({ avatarImgs, knifeImg, swordSfx }) => {
      this.assetsLoaded = true;
      this.avatarImgs = avatarImgs;
      this.knifeImg = knifeImg;
      this.swordSfx = swordSfx;
      
      this.setupCollisionEvents();
      this.start();
    });
  }

  initArena() {
    const padding = GAME_CONFIG.ARENA_MARGIN;
    this.arenaX = padding;
    this.arenaY = padding; 
    this.arenaW = this.canvas.width - padding * 2;
    this.arenaH = this.canvas.height - padding * 2;

    const { obstacles } = createArena(this.world, this.arenaX, this.arenaY, this.arenaW, this.arenaH);
    this.obstacles = obstacles;
  }

  async loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = src;
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`Failed to load asset: ${src}`);
        resolve(img);
      };
    });
  };

  async loadAssets() {
    const knifeImg = await this.loadImage('/knife.png');
    
    const offCanvas = document.createElement('canvas');
    offCanvas.width = knifeImg.width;
    offCanvas.height = knifeImg.height;
    const offCtx = offCanvas.getContext('2d');
    if (offCtx) {
      offCtx.drawImage(knifeImg, 0, 0);
      const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
      const data = imgData.data;
      
      let minX = offCanvas.width, minY = offCanvas.height, maxX = 0, maxY = 0;
      let foundAny = false;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2];
        if (r > 235 && g > 235 && b > 235) {
          data[i+3] = 0;
        } else {
          const x = (i / 4) % offCanvas.width;
          const y = Math.floor((i / 4) / offCanvas.width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          foundAny = true;
        }
      }
      offCtx.putImageData(imgData, 0, 0);

      if (foundAny) {
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        if (cropCtx) {
          cropCtx.drawImage(offCanvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
          const transparentKnife = new Image();
          transparentKnife.src = cropCanvas.toDataURL();
          this.knifeImg = transparentKnife;
        } else {
          this.knifeImg = knifeImg;
        }
      } else {
        this.knifeImg = knifeImg;
      }
    } else {
      this.knifeImg = knifeImg;
    }

    const avatarImgs = await Promise.all([
      this.loadImage('/p1.png'),
      this.loadImage('/p2.png'),
      this.loadImage('/p3.png'),
      this.loadImage('/p4.png'),
      this.loadImage('/p5.png'),
    ]);

    const swordSfx = new Audio('/sword.mp3');
    swordSfx.load();

    return { avatarImgs, knifeImg, swordSfx };
  }

  // ── TIKTOK HANDLERS ──
  onTikTokChat(data: any) {
    const userId = data.uniqueId;
    const player = this.tiktokUsers.get(userId);

    // Only allow spawning if player is NOT in game or is DEAD
    if (player && !player.isDead) {
      // If already alive, just boost movement
      const force = GAME_CONFIG.CHAT_BOOST_FORCE;
      const angle = Math.random() * Math.PI * 2;
      Body.applyForce(player.body, player.body.position, {
        x: Math.cos(angle) * force,
        y: Math.sin(angle) * force
      });
    } else {
      // Spawn new player (Instant respawn if dead)
      this.spawnNewPlayer(data.profilePictureUrl, userId);
    }
  }

  onTikTokGift(data: any) {
    const userId = data.uniqueId;
    let player = this.tiktokUsers.get(userId);

    // Respawn if dead or not exists
    if (!player || player.isDead) {
      this.spawnNewPlayer(data.profilePictureUrl, userId);
      // Wait a bit for spawn to finish or just use the new ref if we can
      // For now, we'll try to find it again after a tick or just let the next gift trigger it
      player = this.tiktokUsers.get(userId);
    }

    if (player && !player.isDead) {
      // Gift 1 coin = +10 HP
      const diamonds = data.diamondCount || 1;
      player.hp += diamonds * 10;
      
      // Also add a sword for any gift
      player.addSword();
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
          this.playHitSfx();
          this.createHitEffect(pair.collision.supports[0]?.x || parentB.position.x, pair.collision.supports[0]?.y || parentB.position.y, '#FF1744');
        } else if (bIsKnife && aIsBody && pA) {
          pA.takeDamage();
          this.playHitSfx();
          this.createHitEffect(pair.collision.supports[0]?.x || parentA.position.x, pair.collision.supports[0]?.y || parentA.position.y, '#FF1744');
        }

        // Removed applyKnockback. Matter.js natively handles bounces perfectly with restitution=1.1.
        // Adding artificial force caused chaotic/brutal movements when crowded.
      }
    });
  }

  startMusic() {
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio();
      this.bgmAudio.volume = 0.6;
      this.bgmAudio.onended = () => {
        this.currentBgmIndex = (this.currentBgmIndex + 1) % this.bgmPlaylist.length;
        this.playNextBgm();
      };
    }
    
    if (this.swordSfx) {
      this.swordSfx.play().then(() => {
        this.swordSfx?.pause();
        this.swordSfx!.currentTime = 0;
      }).catch(() => {});
    }

    this.playNextBgm();
  }

  playNextBgm() {
    if (!this.bgmAudio) return;
    const src = this.bgmPlaylist[this.currentBgmIndex];
    this.bgmAudio.src = src;
    this.bgmAudio.load();
    this.bgmAudio.play().catch(e => {
      console.warn(`BGM Play Failed for ${src}:`, e);
      setTimeout(() => {
        this.currentBgmIndex = (this.currentBgmIndex + 1) % this.bgmPlaylist.length;
        this.playNextBgm();
      }, 1000);
    });
  }

  playHitSfx() {
    const now = performance.now();
    if (now - this.lastSfxTime < 45) return; 
    this.lastSfxTime = now;

    if (this.swordSfx) {
      const sfx = this.swordSfx.cloneNode() as HTMLAudioElement;
      sfx.volume = 0.4 + Math.random() * 0.4; 
      sfx.play().catch(() => {});
    }
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

  reset() {
    // Clear all players from physics world
    this.players.forEach(p => p.destroy());
    this.players = [];
    this.tiktokUsers.clear();
    this.queue = []; // Clear queue
    this.respawnCooldowns.clear(); // Clear all respawn cooldowns
    this.particles = [];
    this.shakeAmount = 0;
    this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
    this.restartTimer = 10000;
    this.state = 'playing';
    this.winner = null;
    
    // Clear obstacles and recreate arena
    this.obstacles.forEach(o => World.remove(this.world, o));
    this.initArena();

    // Start loop again if it was stopped
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(timestamp: number) {
    const delta = timestamp - this.lastTime;
    this.lastTime = timestamp;

    if (this.state === 'gameover') {
      this.restartTimer -= delta;
      if (this.restartTimer <= 0) {
        this.reset();
        return; // Exit current loop, reset() starts a new one
      }
    } else {
      Engine.update(this.engine, 1000 / 60);

      const deadPlayers = this.players.filter(p => p.isDead);
      if (deadPlayers.length > 0) {
        deadPlayers.forEach(p => {
          p.destroy();
          this.tiktokUsers.delete(p.id);
          this.respawnCooldowns.set(p.id, Date.now() + GAME_CONFIG.RESPAWN_COOLDOWN);
        });
        this.players = this.players.filter(p => !p.isDead);
      }

      while (this.players.length < this.MAX_PLAYERS && this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) this.spawnNewPlayer(next.avatarUrl, next.name);
      }

      const alivePlayers = this.players.filter(p => !p.isDead);
      const frameCount = Math.floor(timestamp / 16); 

      for (let i = 0; i < alivePlayers.length; i++) {
        const player = alivePlayers[i];
        
        // AI Optimization: Run heavy search only every 10 frames
        let nearestOpponent: Player | null = null;
        if ((frameCount + i) % 10 === 0) {
          let minDist = Infinity;
          for (let j = 0; j < alivePlayers.length; j++) {
            if (i === j) continue;
            const other = alivePlayers[j];
            const dx = other.body.position.x - player.body.position.x;
            const dy = other.body.position.y - player.body.position.y;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
              minDist = dist;
              nearestOpponent = other;
            }
          }
          (player as any).lastTarget = nearestOpponent;
        } else {
          nearestOpponent = (player as any).lastTarget;
        }

        player.update(delta, nearestOpponent?.body);

        const margin = GAME_CONFIG.ARENA_MARGIN;
        const px = player.body.position.x;
        const py = player.body.position.y;
        let pushX = 0, pushY = 0;
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
    requestAnimationFrame((t) => this.loop(t));
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
    for (const obstacle of this.obstacles) this.renderer.drawObstacle(obstacle);
    for (const player of this.players) if (!player.isDead) this.renderer.drawPlayer(player);
    for (const p of this.particles) p.draw(ctx);
    ctx.restore();
    this.renderHUD();
  }

  createHitEffect(x: number, y: number, color: string) {
    this.shakeAmount = GAME_CONFIG.SHAKE_INTENSITY;
    // FPS Optimization: Cap particles and reduce count per hit
    if (this.particles.length > 50) return; 
    for (let i = 0; i < 5; i++) { // Reduced from 15 to 5
      this.particles.push(new Particle(x, y, color));
    }
  }

  renderHUD() {
    const ctx = this.renderer.ctx;
    const w = this.canvas.width;
    if (this.queue.length > 0) {
      ctx.font = '14px Arial';
      ctx.fillStyle = '#FFD600';
      ctx.textAlign = 'center';
      ctx.fillText(`QUEUE: ${this.queue.length} WAITING`, w / 2, 45);
    }
    const aliveCount = this.players.filter(p => !p.isDead).length;
    if (this.state === 'playing' && aliveCount === 1 && this.players.length > 1) {
      ctx.font = 'bold 32px Arial';
      ctx.fillStyle = '#FFD600';
      ctx.textAlign = 'center';
      ctx.fillText(`VICTORY IN: ${(this.victoryTimer / 1000).toFixed(1)}s`, w / 2, this.canvas.height / 2);
    }
    if (this.state === 'gameover') {
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 10;
      ctx.fillText('GAME WINNER', w / 2, this.canvas.height / 2);
      ctx.font = 'bold 24px Arial';
      ctx.fillText(`WINNER: ${this.winner?.toUpperCase()}`, w / 2, this.canvas.height / 2 + 50);
      
      ctx.font = '18px Arial';
      ctx.fillStyle = '#00FF41';
      ctx.fillText(`RESTARTING IN: ${(this.restartTimer / 1000).toFixed(1)}s`, w / 2, this.canvas.height / 2 + 100);
      ctx.shadowBlur = 0;
    }
  }

  getPlayerColor(index: number) {
    const colors = ['#00E5FF', '#FF1744', '#00E676', '#D1C4E9', '#FFD600'];
    return colors[index % colors.length];
  }
}
