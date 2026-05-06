import Matter from "matter-js";
import { createPhysicsWorld } from "./Physics";
import { createArena } from "./Arena";
import { Player } from "./Player";
import { Renderer } from "./Renderer";
import { GAME_CONFIG } from "./Config";
import {
    world,
    Position,
    Velocity,
    ParticleState,
    createParticle,
} from "./ECS";
import { query, removeEntity } from "bitecs";
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
    state: "playing" | "gameover" = "playing";
    winner: string | null = null;
    lastTime: number = 0;
    victoryTimer: number = GAME_CONFIG.VICTORY_TIMER;
    restartTimer: number = GAME_CONFIG.RESTART_DELAY;
    knifeImg: HTMLImageElement | null = null;
    bgImg: HTMLImageElement | null = null;
    avatarImgs: HTMLImageElement[] = [];
    tiktokUsers: Map<string, Player> = new Map();
    activeMembers: Set<string> = new Set(); // Track users who joined the room
    userData: Map<string, any> = new Map(); // Store profile pictures for auto-respawn
    pendingSpawns: Set<string> = new Set(); // Prevent duplicate spawn calls
    shakeAmount: number = 0;
    queue: { avatarUrl: string; name: string }[] = [];
    respawnCooldowns: Map<string, number> = new Map();
    readonly MAX_PLAYERS = GAME_CONFIG.MAX_PLAYERS;

    bgmPlaylist = GAME_CONFIG.BGM_PLAYLIST;
    currentBgmIndex: number = 0;
    bgmAudio: HTMLAudioElement | null = null;
    lastSfxTime: number = 0;
    fps: number = 0;
    private frameCount_fps: number = 0;
    private lastFpsUpdate: number = 0;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new Renderer(canvas);

        const { engine, world } = createPhysicsWorld();
        this.engine = engine;
        this.world = world;

        this.initArena();

        Promise.all([this.loadAssets(), this.renderer.ready]).then(
            ([{ avatarImgs, knifeImg }]) => {
                this.assetsLoaded = true;
                this.avatarImgs = avatarImgs;
                this.knifeImg = knifeImg;
                this.lastTime = performance.now();
                this.setupCollisionEvents();
                requestAnimationFrame((t) => this.loop(t));
            },
        );
    }

    initArena() {
        const padding = GAME_CONFIG.ARENA_MARGIN;
        this.arenaX = padding;
        this.arenaY = padding;
        this.arenaW = this.canvas.width - padding * 2;
        this.arenaH = this.canvas.height - padding * 2;

        const { obstacles } = createArena(
            this.world,
            this.arenaX,
            this.arenaY,
            this.arenaW,
            this.arenaH,
        );
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
    }

    async loadAssets() {
        const knifeImg = await this.loadImage("/knife.png");

        const offCanvas = document.createElement("canvas");
        offCanvas.width = knifeImg.width;
        offCanvas.height = knifeImg.height;
        const offCtx = offCanvas.getContext("2d");
        if (offCtx) {
            offCtx.drawImage(knifeImg, 0, 0);
            const imgData = offCtx.getImageData(
                0,
                0,
                offCanvas.width,
                offCanvas.height,
            );
            const data = imgData.data;

            let minX = offCanvas.width,
                minY = offCanvas.height,
                maxX = 0,
                maxY = 0;
            let foundAny = false;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i],
                    g = data[i + 1],
                    b = data[i + 2];
                if (r > 235 && g > 235 && b > 235) {
                    data[i + 3] = 0;
                } else {
                    const x = (i / 4) % offCanvas.width;
                    const y = Math.floor(i / 4 / offCanvas.width);
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
                const cropCanvas = document.createElement("canvas");
                cropCanvas.width = cropW;
                cropCanvas.height = cropH;
                const cropCtx = cropCanvas.getContext("2d");
                if (cropCtx) {
                    cropCtx.drawImage(
                        offCanvas,
                        minX,
                        minY,
                        cropW,
                        cropH,
                        0,
                        0,
                        cropW,
                        cropH,
                    );
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
            this.loadImage("/p1.png"),
            this.loadImage("/p2.png"),
            this.loadImage("/p3.png"),
            this.loadImage("/p4.png"),
            this.loadImage("/p5.png"),
        ]);

        return { avatarImgs, knifeImg };
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
                y: Math.sin(angle) * force,
            });
        } else {
            // Queue new player spawn
            this.queueSpawn(data.profilePictureUrl, userId);
        }
    }

    onTikTokMember(data: any) {
        const userId = data.uniqueId;
        this.activeMembers.add(userId);
        this.userData.set(userId, data); // Store data for re-spawning

        const player = this.tiktokUsers.get(userId);
        if (!player || player.isDead) {
            this.queueSpawn(data.profilePictureUrl, userId);
        }
    }

    onTikTokGift(data: any) {
        const userId = data.uniqueId;
        let player = this.tiktokUsers.get(userId);

        // Respawn if dead or not exists
        if (!player || player.isDead) {
            this.queueSpawn(data.profilePictureUrl, userId);
            player = this.tiktokUsers.get(userId);
        }

        if (player && !player.isDead) {
            // Gift 1 coin = +50 HP
            const diamonds = data.diamondCount || 1;
            player.hp += diamonds * 50;

            // Grow size: 2% per diamond
            player.grow(1 + 0.02 * diamonds);

            // Also add a sword for any gift
            player.addSword();
        }
    }

    onTikTokLike(data: any) {
        const userId = data.uniqueId;
        const player = this.tiktokUsers.get(userId);

        if (!player || player.isDead) {
            // Auto-spawn on like too! (For better accuracy)
            const profilePic =
                data.profilePictureUrl ||
                `https://api.dicebear.com/7.x/pixel-art/svg?seed=${userId}`;
            this.queueSpawn(profilePic, userId);
        }

        this.players.forEach((p) => {
            if (!p.isDead) {
                const vel = p.body.velocity;
                Body.setVelocity(p.body, {
                    x: vel.x * GAME_CONFIG.LIKE_BOOST_MULTIPLIER,
                    y: vel.y * GAME_CONFIG.LIKE_BOOST_MULTIPLIER,
                });
            }
        });
    }

    queueSpawn(avatarUrl: string, name: string) {
        // Prevent duplicate queue entries or spawning if already alive/pending
        if (this.pendingSpawns.has(name)) return;
        if (this.tiktokUsers.has(name) && !this.tiktokUsers.get(name)?.isDead) return;
        if (this.queue.some(q => q.name === name)) return;

        this.queue.push({ avatarUrl, name });
    }

    async spawnNewPlayer(avatarUrl: string, name: string) {
        if (this.pendingSpawns.has(name)) return;
        if (this.tiktokUsers.has(name) && !this.tiktokUsers.get(name)?.isDead)
            return;

        this.pendingSpawns.add(name);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = avatarUrl;

        await Promise.race([
            new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
            }),
            new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);

        const r = GAME_CONFIG.PLAYER_RADIUS;
        const x = this.arenaX + Math.random() * this.arenaW;
        const y = this.arenaY + Math.random() * this.arenaH;

        const avatarToUse = img.complete
            ? img
            : this.avatarImgs[
                  Math.floor(Math.random() * this.avatarImgs.length)
              ];

        const newPlayer = new Player(
            this.world,
            x,
            y,
            r,
            name.substring(0, 8),
            avatarToUse,
            this.knifeImg,
        );
        newPlayer.tiktokProfileImg = img.complete ? img : null;

        newPlayer.applyInitialImpulse();
        this.players.push(newPlayer);
        this.tiktokUsers.set(name, newPlayer);
        this.registerPlayerBody(newPlayer);
        // Keep bodyPlayerMap in sync when player grows/adds sword (body is recreated)
        (newPlayer as any)._onBodyRecreated = (p: Player) => {
            // old body already removed from world; remove stale map entry and add new one
            for (const [body, player] of this.bodyPlayerMap) {
                if (player === p) {
                    this.bodyPlayerMap.delete(body);
                    break;
                }
            }
            this.bodyPlayerMap.set(p.body, p);
        };
        this.pendingSpawns.delete(name);
    }

    // O(1) body→player lookup: built once, updated on spawn/death
    private bodyPlayerMap: Map<Matter.Body, Player> = new Map();

    private registerPlayerBody(player: Player) {
        this.bodyPlayerMap.set(player.body, player);
    }

    private unregisterPlayerBody(player: Player) {
        this.bodyPlayerMap.delete(player.body);
    }

    setupCollisionEvents() {
        Events.on(this.engine, "collisionStart", (event) => {
            const pairs = event.pairs;

            for (const pair of pairs) {
                const { bodyA, bodyB } = pair;
                const parentA = bodyA.parent || bodyA;
                const parentB = bodyB.parent || bodyB;

                // O(1) lookup instead of O(n) find()
                const pA = this.bodyPlayerMap.get(parentA);
                const pB = this.bodyPlayerMap.get(parentB);

                const idA = (bodyA as any).playerId;
                const idB = (bodyB as any).playerId;

                if (!idA || !idB || idA === idB) continue;

                const aIsKnife = bodyA.label === "player-knife";
                const bIsKnife = bodyB.label === "player-knife";
                const aIsBody = bodyA.label === "player-body";
                const bIsBody = bodyB.label === "player-body";

                if (aIsKnife && bIsBody && pB) {
                    if (pB.takeDamage() && pA) {
                        pA.onHitDealt();
                    }
                    this.playHitSfx();
                    this.createHitEffect(
                        pair.collision.supports[0]?.x || parentB.position.x,
                        pair.collision.supports[0]?.y || parentB.position.y,
                        0,
                    );
                } else if (bIsKnife && aIsBody && pA) {
                    if (pA.takeDamage() && pB) {
                        pB.onHitDealt();
                    }
                    this.playHitSfx();
                    this.createHitEffect(
                        pair.collision.supports[0]?.x || parentA.position.x,
                        pair.collision.supports[0]?.y || parentA.position.y,
                        0,
                    );
                }
            }
        });
    }

    startMusic() {
        if (!this.bgmAudio) {
            this.bgmAudio = new Audio();
            this.bgmAudio.volume = GAME_CONFIG.BGM_VOLUME;
            this.bgmAudio.onended = () => {
                this.currentBgmIndex =
                    (this.currentBgmIndex + 1) % this.bgmPlaylist.length;
                this.playNextBgm();
            };
        }

        this.playNextBgm();
    }

    playNextBgm() {
        if (!this.bgmAudio) return;
        const src = this.bgmPlaylist[this.currentBgmIndex];
        this.bgmAudio.src = src;
        this.bgmAudio.load();
        this.bgmAudio.play().catch((e) => {
            console.warn(`BGM Play Failed for ${src}:`, e);
            setTimeout(() => {
                this.currentBgmIndex =
                    (this.currentBgmIndex + 1) % this.bgmPlaylist.length;
                this.playNextBgm();
            }, 1000);
        });
    }

    playHitSfx() {
        // Sound disabled to prevent noise in high-density combat
        /*
    const now = performance.now();
    if (now - this.lastSfxTime < 45) return; 
    this.lastSfxTime = now;

    if (this.swordSfx) {
      const sfx = this.swordSfx.cloneNode() as HTMLAudioElement;
      sfx.volume = 0.4 + Math.random() * 0.4; 
      sfx.play().catch(() => {});
    }
    */
    }

    applyKnockback(
        pair: Matter.Pair,
        parentA: Matter.Body,
        parentB: Matter.Body,
    ) {
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
        this.players.forEach((p) => p.destroy());
        this.players = [];
        this.tiktokUsers.clear();
        this.activeMembers.clear();
        this.userData.clear();
        this.queue = [];
        this.respawnCooldowns.clear();
        this.shakeAmount = 0;
        this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
        this.restartTimer = 10000;
        this.state = "playing";
        this.winner = null;

        this.obstacles.forEach((o) => World.remove(this.world, o));
        this.initArena();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.loop(t));
    }

    loop(timestamp: number) {
        const delta = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.frameCount_fps++;
        if (timestamp - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount_fps;
            this.frameCount_fps = 0;
            this.lastFpsUpdate = timestamp;
        }

        if (this.state === "gameover") {
            this.restartTimer -= delta;
            if (this.restartTimer <= 0) {
                this.reset();
                return;
            }
        } else {
            Engine.update(this.engine, 1000 / 60);

            const deadPlayers = this.players.filter((p) => p.isDead);
            if (deadPlayers.length > 0) {
                deadPlayers.forEach((player) => {
                    this.unregisterPlayerBody(player); // remove from O(1) map
                    player.destroy();
                    this.tiktokUsers.delete(player.id);
                    this.respawnCooldowns.set(
                        player.id,
                        Date.now() + GAME_CONFIG.RESPAWN_COOLDOWN,
                    );
                    // Clear sword trails for dead players
                    player.swordTrails.forEach((t) => (t.length = 0));

                    // AUTO-RESPAWN logic
                    if (this.activeMembers.has(player.id)) {
                        const data = this.userData.get(player.id);
                        if (data) {
                            // Respawn after a short delay (e.g. 1 second)
                            setTimeout(() => {
                                const stillActive = this.activeMembers.has(
                                    player.id,
                                );
                                const isStillDead =
                                    !this.tiktokUsers.get(player.id) ||
                                    this.tiktokUsers.get(player.id)!.isDead;
                                if (stillActive && isStillDead) {
                                    this.spawnNewPlayer(
                                        data.profilePictureUrl,
                                        player.id,
                                    );
                                }
                            }, 1000);
                        }
                    }
                });
                this.players = this.players.filter((p) => !p.isDead);
            }

            while (
                this.players.length + this.pendingSpawns.size < this.MAX_PLAYERS &&
                this.queue.length > 0
            ) {
                const next = this.queue.shift();
                if (next) this.spawnNewPlayer(next.avatarUrl, next.name);
            }

            const ents = query(world, [Position, Velocity, ParticleState]);
            for (let i = 0; i < ents.length; i++) {
                const eid = ents[i];

                Position.x[eid] += Velocity.x[eid];
                Position.y[eid] += Velocity.y[eid];
                Velocity.y[eid] += GAME_CONFIG.PARTICLE_GRAVITY;

                ParticleState.life[eid] -= GAME_CONFIG.PARTICLE_DECAY;

                if (ParticleState.life[eid] <= 0) {
                    removeEntity(world, eid);
                }
            }

            const alivePlayers = this.players; // already filtered dead out above
            const frameCount = Math.floor(timestamp / 16);

            // ── SPATIAL GRID FOR AI OPTIMIZATION ──
            const grid: Map<string, Player[]> = new Map();
            const cellSize = 150; // Spatial grid cell size
            for (let i = 0; i < alivePlayers.length; i++) {
                const p = alivePlayers[i];
                const gx = Math.floor(p.body.position.x / cellSize);
                const gy = Math.floor(p.body.position.y / cellSize);
                const key = `${gx},${gy}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key)!.push(p);
            }

            for (let i = 0; i < alivePlayers.length; i++) {
                const player = alivePlayers[i];

                let nearestOpponent: Player | null = null;
                if ((frameCount + i) % 30 === 0) {
                    let minDist = Infinity;
                    const gx = Math.floor(player.body.position.x / cellSize);
                    const gy = Math.floor(player.body.position.y / cellSize);

                    // Check 3x3 cells around player
                    for (let ox = -1; ox <= 1; ox++) {
                        for (let oy = -1; oy <= 1; oy++) {
                            const key = `${gx + ox},${gy + oy}`;
                            const cell = grid.get(key);
                            if (!cell) continue;

                            for (const other of cell) {
                                if (other === player) continue;
                                const dx =
                                    other.body.position.x -
                                    player.body.position.x;
                                const dy =
                                    other.body.position.y -
                                    player.body.position.y;
                                const dist = dx * dx + dy * dy;
                                if (dist < minDist) {
                                    minDist = dist;
                                    nearestOpponent = other;
                                }
                            }
                        }
                    }

                    // Fallback to global search if no one is found in local grid
                    if (!nearestOpponent) {
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
                    }
                    (player as any).lastTarget = nearestOpponent;
                } else {
                    nearestOpponent = (player as any).lastTarget;
                }

                player.update(delta, nearestOpponent?.body);

                const margin = GAME_CONFIG.ARENA_MARGIN;
                const px = player.body.position.x;
                const py = player.body.position.y;
                let pushX = 0,
                    pushY = 0;
                if (px < this.arenaX - margin) pushX = 1;
                if (px > this.arenaX + this.arenaW + margin) pushX = -1;
                if (py < this.arenaY - margin) pushY = 1;
                if (py > this.arenaY + this.arenaH + margin) pushY = -1;
                if (pushX !== 0 || pushY !== 0) {
                    const pushForce = 5;
                    Body.setVelocity(player.body, {
                        x: player.body.velocity.x * 0.5 + pushX * pushForce,
                        y: player.body.velocity.y * 0.5 + pushY * pushForce,
                    });
                    Body.setPosition(player.body, {
                        x: Math.max(
                            this.arenaX,
                            Math.min(this.arenaX + this.arenaW, px),
                        ),
                        y: Math.max(
                            this.arenaY,
                            Math.min(this.arenaY + this.arenaH, py),
                        ),
                    });
                }
            }

            if (this.players.length === 1) {
                this.victoryTimer -= delta;
                if (this.victoryTimer <= 0) {
                    this.state = "gameover";
                    this.winner = this.players[0].id;
                }
            } else if (this.players.length > 1) {
                this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
            }
        }

        this.shakeAmount *= 0.9;
        if (this.shakeAmount < 0.1) this.shakeAmount = 0;

        this.render();
        requestAnimationFrame((t) => this.loop(t));
    }

    render() {
        if (!this.assetsLoaded) return;
        this.renderer.render(this);
    }

    createHitEffect(x: number, y: number, colorId: number = 0) {
        this.shakeAmount = GAME_CONFIG.SHAKE_INTENSITY;
        // ECS particles are extremely fast, we can safely spawn more without FPS drop
        for (let i = 0; i < 4; i++) {
            createParticle(x, y, colorId);
        }
    }

    getPlayerColor(index: number) {
        const colors = GAME_CONFIG.PLAYER_COLORS;
        return colors[index % colors.length];
    }
}
