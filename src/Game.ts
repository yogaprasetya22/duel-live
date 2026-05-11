import Matter from "matter-js";
import { createPhysicsWorld } from "./Physics";
import { createArena } from "./Arena";
import { Player } from "./Player";
import { Renderer } from "./Renderer";
import { GAME_CONFIG } from "./Config";
import { SpatialHash } from "./SpatialHash";
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
    physicsAccumulator: number = 0; // Fixed timestep accumulator
    queue: {
        avatarUrl: string;
        name: string;
        isPriority?: boolean;
        bonusHp?: number;
    }[] = [];
    pendingBonusHp: Map<string, number> = new Map(); // Store gift HP while image is loading
    respawnCooldowns: Map<string, number> = new Map();
    playerPool: Player[] = [];
    winnersHistory: { name: string; avatarUrl: string | null }[] = [];
    currentKingId: string | null = null;
    readonly MAX_PLAYERS = GAME_CONFIG.MAX_PLAYERS;
    hasHadMultiplePlayers: boolean = false; // New flag to prevent instant victory

    bgmPlaylist = GAME_CONFIG.BGM_PLAYLIST;
    currentBgmIndex: number = 0;
    bgmAudio: HTMLAudioElement | null = null;
    lastSfxTime: number = 0;
    fps: number = 0;
    private frameCount_fps: number = 0;
    private lastFpsUpdate: number = 0;
    private spatialHash!: SpatialHash;
    private queryBuffer: Uint32Array = new Uint32Array(512); // Pre-allocated buffer for search

    // Performance Tracking
    private perfHistory: {
        t: number;
        fps: number;
        dt: number;
        physics: number;
        logic: number;
        render: number;
        mem?: number;
        players: number;
        particles: number;
    }[] = [];
    private maxPerfEntries: number = 5000;
    private frameCounter: number = 0;
    private _lastParticleCount: number = 0; // cached from logic pass to avoid double ECS query

    constructor(canvas: HTMLCanvasElement) {
        this.spatialHash = new SpatialHash(2000, 2000, 150);
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
                this.initArena(); // Re-init arena after renderer is ready and dimensions are stable
                this.lastTime = performance.now();
                this.setupCollisionEvents();
                requestAnimationFrame((t) => this.loop(t));
            },
        );
    }

    initArena() {
        const padding = GAME_CONFIG.ARENA_MARGIN;
        const isPortrait = window.innerHeight > window.innerWidth;

        const topBarHeight = isPortrait ? 50 : 85;
        const sidebarWidth = isPortrait ? 0 : window.innerWidth * 0.25;
        this.arenaX = padding;
        this.arenaY = topBarHeight; // Removed top padding to close the gap
        this.arenaW = window.innerWidth - sidebarWidth - padding * 2;
        this.arenaH = window.innerHeight - topBarHeight - padding; // Adjusted height accordingly

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

        if (player && !player.isDead) {
            // BRUTAL CHAT: Stronger force + minor shake + small particle burst
            const force = GAME_CONFIG.CHAT_BOOST_FORCE * 1.5;
            const angle = Math.random() * Math.PI * 2;
            Body.applyForce(player.body, player.body.position, {
                x: Math.cos(angle) * force,
                y: Math.sin(angle) * force,
            });

            this.shakeAmount = Math.max(this.shakeAmount, 2);
            for (let i = 0; i < 2; i++)
                createParticle(
                    player.body.position.x,
                    player.body.position.y,
                    1,
                );
        } else {
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
        const diamonds = data.diamondCount || 1;
        const giftBonusHp = diamonds * GAME_CONFIG.GIFT_HP_BONUS;

        if (!player || player.isDead) {
            // VIP JOIN: If room for VIPs, spawn immediately
            if (
                this.players.length + this.pendingSpawns.size <
                GAME_CONFIG.VIP_MAX_PLAYERS
            ) {
                this.spawnNewPlayer(
                    data.profilePictureUrl,
                    userId,
                    giftBonusHp,
                );
            } else {
                this.queueSpawn(
                    data.profilePictureUrl,
                    userId,
                    true,
                    giftBonusHp,
                );
            }
            return; // No player object yet, handled by spawn/queue
        }

        // Existing player logic
        player.hp = Math.min(
            GAME_CONFIG.MAX_PLAYER_HP,
            player.hp + giftBonusHp,
        );
        player.grow(1 + 0.05 * Math.log10(diamonds + 1));

        // Sword count is now handled by syncSwordsToHp() in the loop

        // Screen Shake & Effects
        this.shakeAmount = Math.min(20, this.shakeAmount + diamonds * 0.1);
        this.renderer.triggerShockwave(
            player.body.position.x,
            player.body.position.y,
        );

        // Particle explosion on gift — hard cap at 15 to prevent spikes
        const particleCount = Math.min(15, 3 + Math.floor(diamonds / 5));
        for (let i = 0; i < particleCount; i++) {
            const type = Math.random() > 0.7 ? 2 : Math.random() > 0.4 ? 1 : 0;
            const colorIdx = Math.floor(Math.random() * 5);
            createParticle(
                player.body.position.x,
                player.body.position.y,
                colorIdx,
                type,
            );
        }

        // Visual shockwave and Screen flash
        this.renderer.triggerShockwave(
            player.body.position.x,
            player.body.position.y,
        );

        // Apply massive radial impulse to nearby players (Optimized via SpatialHash)
        const pushForce = 0.01 * diamonds;
        const queryRadius = 300;
        const foundCount = this.spatialHash.query(
            player.body.position.x,
            player.body.position.y,
            queryRadius,
            this.queryBuffer,
        );

        for (let i = 0; i < foundCount; i++) {
            const otherIdx = this.queryBuffer[i];
            const p = this.players[otherIdx];

            if (!p || p === player || p.isDead) continue;

            const dx = p.body.position.x - player.body.position.x;
            const dy = p.body.position.y - player.body.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0 && dist < queryRadius) {
                Body.applyForce(p.body, p.body.position, {
                    x: (dx / dist) * pushForce,
                    y: (dy / dist) * pushForce,
                });
            }
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

    queueSpawn(
        avatarUrl: string,
        name: string,
        isPriority: boolean = false,
        bonusHp: number = 0,
    ) {
        // Prevent duplicate queue entries or spawning if already alive/pending
        if (this.pendingSpawns.has(name)) {
            // Already loading, add to pending bonus HP
            const current = this.pendingBonusHp.get(name) || 0;
            this.pendingBonusHp.set(name, current + bonusHp);
            return;
        }
        if (this.tiktokUsers.has(name) && !this.tiktokUsers.get(name)?.isDead)
            return;

        // Priority & Bonus Logic: If already in queue, update their data
        const existingIdx = this.queue.findIndex((q) => q.name === name);
        if (existingIdx !== -1) {
            const item = this.queue[existingIdx];
            item.bonusHp = (item.bonusHp || 0) + bonusHp;
            if (isPriority) {
                item.isPriority = true;
                this.queue.splice(existingIdx, 1);
                this.queue.unshift(item); // Move to front
            }
            return;
        }

        if (isPriority) {
            this.queue.unshift({ avatarUrl, name, isPriority: true, bonusHp });
        } else {
            this.queue.push({ avatarUrl, name, isPriority: false, bonusHp });
        }
    }

    private applyExplosionImpulse(
        x: number,
        y: number,
        radius: number,
        force: number,
    ) {
        const foundCount = this.spatialHash.query(
            x,
            y,
            radius,
            this.queryBuffer,
        );
        for (let i = 0; i < foundCount; i++) {
            const p = this.players[this.queryBuffer[i]];
            if (!p || p.isDead) continue;

            const dx = p.body.position.x - x;
            const dy = p.body.position.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0 && dist < radius) {
                Body.applyForce(p.body, p.body.position, {
                    x: (dx / dist) * force,
                    y: (dy / dist) * force,
                });
            }
        }
    }

    async loadProfileImage(url: string): Promise<HTMLImageElement> {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;

        await Promise.race([
            new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
            }),
            new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);

        return img.complete
            ? img
            : this.avatarImgs[
                  Math.floor(Math.random() * this.avatarImgs.length)
              ];
    }

    async spawnNewPlayer(avatarUrl: string, name: string, bonusHp: number = 0) {
        if (this.pendingSpawns.has(name)) return;
        this.pendingSpawns.add(name);
        if (bonusHp > 0) this.pendingBonusHp.set(name, bonusHp);

        try {
            const avatarToUse = await this.loadProfileImage(avatarUrl);

            // Re-check bonus in case more gifts came while loading
            const finalBonus = this.pendingBonusHp.get(name) || 0;
            this.pendingBonusHp.delete(name);

            const isPortrait = window.innerHeight > window.innerWidth;
            const baseRadius = isPortrait ? 25 : GAME_CONFIG.PLAYER_RADIUS;

            const padding = GAME_CONFIG.SPAWN_MARGIN;
            const x =
                this.arenaX +
                padding +
                Math.random() * (this.arenaW - padding * 2);
            const y =
                this.arenaY +
                padding +
                Math.random() * (this.arenaH - padding * 2);

            let newPlayer: Player;

            // REUSE FROM POOL OR CREATE NEW
            if (this.playerPool.length > 0) {
                newPlayer = this.playerPool.pop()!;
                newPlayer.reset(
                    x,
                    y,
                    name.substring(0, 8),
                    avatarToUse,
                    baseRadius,
                );
                World.add(this.world, newPlayer.body);
            } else {
                newPlayer = new Player(
                    this.world,
                    x,
                    y,
                    baseRadius,
                    name.substring(0, 8),
                    avatarToUse,
                    this.knifeImg,
                );
            }

            // Apply Bonus HP
            newPlayer.hp += finalBonus;

            this.tiktokUsers.set(name, newPlayer);
            this.players.push(newPlayer);
            this.registerPlayerBody(newPlayer);
            newPlayer.applyInitialImpulse();
        } catch (err) {
            console.error("Failed to spawn player:", name, err);
            this.pendingBonusHp.delete(name);
        } finally {
            this.pendingSpawns.delete(name);
        }
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

                const aIsKnife =
                    bodyA.label === "player-knife" && !bodyA.isSensor;
                const bIsKnife =
                    bodyB.label === "player-knife" && !bodyB.isSensor;
                const aIsBody = bodyA.label === "player-body";
                const bIsBody = bodyB.label === "player-body";

                if (aIsKnife && bIsBody && pB) {
                    if (pB.takeDamage()) {
                        if (pA) pA.onHitDealt();
                        this.playHitSfx();
                        const hx =
                            pair.collision.supports[0]?.x || parentB.position.x;
                        const hy =
                            pair.collision.supports[0]?.y || parentB.position.y;
                        this.createHitEffect(hx, hy, 0);
                        this.renderer.drawDecal(hx, hy);
                    }
                } else if (bIsKnife && aIsBody && pA) {
                    if (pA.takeDamage()) {
                        if (pB) pB.onHitDealt();
                        this.playHitSfx();
                        const hx =
                            pair.collision.supports[0]?.x || parentA.position.x;
                        const hy =
                            pair.collision.supports[0]?.y || parentA.position.y;
                        this.createHitEffect(hx, hy, 0);
                        this.renderer.drawDecal(hx, hy);
                    }
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
        this.state = "playing";
        this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
        this.winner = null;

        // Clear all current players correctly
        for (const player of this.players) {
            this.unregisterPlayerBody(player);
            World.remove(this.world, player.body);
        }
        this.players = [];
        this.tiktokUsers.clear();
        this.queue = [];
        this.pendingSpawns.clear();

        // Clear cooldowns so everyone can rejoin
        this.respawnCooldowns.clear();

        // Optional: Periodic aggressive cleanup of persistent maps to prevent multi-day leaks
        if (this.userData.size > 2000) {
            this.userData.clear();
            this.activeMembers.clear();
        }

        this.shakeAmount = 0;
        this.victoryTimer = GAME_CONFIG.VICTORY_TIMER;
        this.restartTimer = 10000;
        this.state = "playing";
        this.winner = null;

        this.obstacles.forEach((o) => World.remove(this.world, o));
        this.initArena();

        this.lastTime = performance.now();
        this.hasHadMultiplePlayers = false; // Reset flag
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

        let physicsTime = 0;
        let logicTime = 0;
        let renderTime = 0;

        if (this.state === "gameover") {
            const startLogic = performance.now();
            this.restartTimer -= delta;
            if (this.restartTimer <= 0) {
                this.reset();
                // Don't return — keep the loop alive by falling through to rAF at the bottom
            }
            logicTime = performance.now() - startLogic;
        } else {
            // ── FIXED TIMESTEP PHYSICS ──────────────────────────────────────────
            // Always step at exactly 16.67ms. If browser delivers a double-frame
            // (33ms dt), we run physics TWICE at 16.67ms each instead of once at
            // 33ms. This completely eliminates speed-burst from V-sync skips.
            const startPhysics = performance.now();
            const FIXED_STEP = 1000 / 60; // 16.666ms
            const MAX_STEPS = 2;          // Never run more than 2 steps to avoid spiral-of-death
            this.physicsAccumulator += Math.min(delta, 50); // Cap total accumulation
            let steps = 0;
            while (this.physicsAccumulator >= FIXED_STEP && steps < MAX_STEPS) {
                Engine.update(this.engine, FIXED_STEP);
                this.physicsAccumulator -= FIXED_STEP;
                steps++;
            }

            // Clamp velocity to prevent Matter.js runaway acceleration (physics explosion)
            const maxSpeed = GAME_CONFIG.MAX_SPEED * 1.5;
            for (const player of this.players) {
                if (player.isDead) continue;
                const vel = player.body.velocity;
                const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
                if (speed > maxSpeed) {
                    const scale = maxSpeed / speed;
                    Body.setVelocity(player.body, { x: vel.x * scale, y: vel.y * scale });
                }
            }
            physicsTime = performance.now() - startPhysics;

            // LOGIC (AI, ECS, State)
            const startLogic = performance.now();
            const aliveCount = this.players.length;
            if (aliveCount >= 2) this.hasHadMultiplePlayers = true; // Mark that a real battle happened

            let deadFound = false;
            for (let i = 0; i < aliveCount; i++) {
                const player = this.players[i];
                if (!player) continue;

                // DYNAMIC PRESTIGE & SIZE BASED ON HP (100% ACCURACY)
                player.isLegendary =
                    player.hp >= GAME_CONFIG.PRESTIGE_HP_LEGENDARY;
                player.isEpic =
                    !player.isLegendary &&
                    player.hp >= GAME_CONFIG.PRESTIGE_HP_EPIC;
                player.isElite =
                    !player.isLegendary &&
                    !player.isEpic &&
                    player.hp >= GAME_CONFIG.PRESTIGE_HP_ELITE;

                const isPortrait = window.innerHeight > window.innerWidth;
                const baseRadius = isPortrait ? 25 : GAME_CONFIG.PLAYER_RADIUS;
                player.syncSizeToHp(baseRadius, GAME_CONFIG.MAX_PLAYER_RADIUS);
                player.syncSwordsToHp();

                // ── SPECIAL SKILL: SHOCKWAVE NOVA ──
                if (player.isLegendary) {
                    if (!player.lastSkillTime) player.lastSkillTime = 0;
                    const now = Date.now();

                    // Skill 1: Shockwave Nova
                    if (
                        now - player.lastSkillTime >
                        GAME_CONFIG.SKILL_SHOCKWAVE_COOLDOWN
                    ) {
                        player.lastSkillTime = now;
                        this.renderer.triggerShockwave(
                            player.body.position.x,
                            player.body.position.y,
                        );
                        this.applyExplosionImpulse(
                            player.body.position.x,
                            player.body.position.y,
                            GAME_CONFIG.SKILL_SHOCKWAVE_RADIUS,
                            GAME_CONFIG.SKILL_SHOCKWAVE_FORCE,
                        );
                    }

                    // Skill 2: Heavenly Strike (Lightning)
                    if (!player.lastLightningTime) player.lastLightningTime = 0;
                    if (
                        now - player.lastLightningTime >
                        GAME_CONFIG.SKILL_LIGHTNING_COOLDOWN
                    ) {
                        player.lastLightningTime = now;
                        // MULTI-TARGET CHAIN LIGHTNING
                        const targets = [];
                        const queryRadius = GAME_CONFIG.SKILL_LIGHTNING_RADIUS;
                        const foundCount = this.spatialHash.query(
                            player.body.position.x,
                            player.body.position.y,
                            queryRadius,
                            this.queryBuffer,
                        );
                        for (let j = 0; j < foundCount; j++) {
                            const other = this.players[this.queryBuffer[j]];
                            if (!other || other === player || other.isDead)
                                continue;

                            const dist = Matter.Vector.magnitude(
                                Matter.Vector.sub(
                                    other.body.position,
                                    player.body.position,
                                ),
                            );
                            if (dist < queryRadius) {
                                targets.push({ player: other, dist });
                            }
                        }

                        // Sort by distance and take up to Max Targets
                        targets.sort((a, b) => a.dist - b.dist);
                        const targetsToHit = targets.slice(
                            0,
                            GAME_CONFIG.SKILL_LIGHTNING_MAX_TARGETS,
                        );

                        if (targetsToHit.length > 0) {
                            // Massive camera shake for impact instead of hit stop
                            this.shakeAmount += 15;

                            for (const t of targetsToHit) {
                                const target = t.player;
                                target.hp -= GAME_CONFIG.SKILL_LIGHTNING_DAMAGE;
                                if (target.hp <= 0) target.isDead = true;

                                this.renderer.triggerLightning(
                                    player.body.position.x,
                                    player.body.position.y,
                                    target.body.position.x,
                                    target.body.position.y,
                                );
                                // Only full effect on death; otherwise cheap flash
                                if (target.isDead) {
                                    this.createDeathEffect(
                                        target.body.position.x,
                                        target.body.position.y,
                                    );
                                } else {
                                    this.renderer.triggerFlash(0.05);
                                }
                            }
                        }
                    }
                }

                if (player.isDead) {
                    deadFound = true;
                    // Trigger Death Explosion!
                    this.createDeathEffect(
                        player.body.position.x,
                        player.body.position.y,
                    );

                    this.unregisterPlayerBody(player);
                    World.remove(this.world, player.body);
                    this.tiktokUsers.delete(player.id);
                    this.respawnCooldowns.set(
                        player.id,
                        Date.now() + GAME_CONFIG.RESPAWN_COOLDOWN,
                    );
                    this.playerPool.push(player);

                    if (this.activeMembers.has(player.id)) {
                        const data = this.userData.get(player.id);
                        if (data) {
                            setTimeout(() => {
                                if (
                                    this.activeMembers.has(player.id) &&
                                    (!this.tiktokUsers.get(player.id) ||
                                        this.tiktokUsers.get(player.id)!.isDead)
                                ) {
                                    this.spawnNewPlayer(
                                        data.profilePictureUrl,
                                        player.id,
                                    );
                                }
                            }, 1000);
                        }
                    }
                }
            }
            if (deadFound) {
                this.players = this.players.filter((p) => !p.isDead);
            }

            while (this.queue.length > 0) {
                const next = this.queue[0]; // Peek
                const currentLimit = next.isPriority
                    ? GAME_CONFIG.VIP_MAX_PLAYERS
                    : GAME_CONFIG.MAX_PLAYERS;

                if (
                    this.players.length + this.pendingSpawns.size <
                    currentLimit
                ) {
                    this.queue.shift();
                    this.spawnNewPlayer(
                        next.avatarUrl,
                        next.name,
                        next.bonusHp || 0,
                    );
                } else {
                    break; // Room full for the next person in line
                }
            }

            // Logic for particles (reuse query result in perf log below)
            const ents = query(world, [Position, Velocity, ParticleState]);
            let particleCount = 0;
            for (let i = 0; i < ents.length; i++) {
                const eid = ents[i];
                Position.x[eid] += Velocity.x[eid];
                Position.y[eid] += Velocity.y[eid];
                Velocity.y[eid] += GAME_CONFIG.PARTICLE_GRAVITY;
                ParticleState.rotation[eid] += ParticleState.vr[eid];
                ParticleState.life[eid] -= GAME_CONFIG.PARTICLE_DECAY;
                if (ParticleState.life[eid] <= 0) {
                    removeEntity(world, eid);
                } else {
                    particleCount++;
                }
            }
            const alivePlayers = this.players;
            const frameCount = Math.floor(timestamp / 16);

            this.spatialHash.clear();
            for (let i = 0; i < alivePlayers.length; i++) {
                const p = alivePlayers[i];
                this.spatialHash.insert(
                    i,
                    p.body.position.x,
                    p.body.position.y,
                );
            }

            for (let i = 0; i < alivePlayers.length; i++) {
                const player = alivePlayers[i];

                // ── Boundary Safety Clamp ──
                // If a player somehow tunnels through a wall (high speed or spawn glitch),
                // teleport them back to the center of the arena.
                const pos = player.body.position;
                const outMargin = 150;
                if (
                    pos.x < this.arenaX - outMargin ||
                    pos.x > this.arenaX + this.arenaW + outMargin ||
                    pos.y < this.arenaY - outMargin ||
                    pos.y > this.arenaY + this.arenaH + outMargin
                ) {
                    Matter.Body.setPosition(player.body, {
                        x: this.arenaX + this.arenaW / 2,
                        y: this.arenaY + this.arenaH / 2,
                    });
                    Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
                }

                let nearestOpponent: Player | null = null;
                // Throttle AI targeting even more: only check every 45 frames on mobile
                const targetThrottle = window.innerWidth < 600 ? 45 : 30;
                if ((frameCount + i) % targetThrottle === 0) {
                    let minDist = Infinity;
                    const foundCount = this.spatialHash.query(
                        player.body.position.x,
                        player.body.position.y,
                        300,
                        this.queryBuffer,
                    );

                    for (let j = 0; j < foundCount; j++) {
                        const otherIdx = this.queryBuffer[j];
                        const other = alivePlayers[otherIdx];
                        if (other === player) continue;
                        const dx =
                            other.body.position.x - player.body.position.x;
                        const dy =
                            other.body.position.y - player.body.position.y;
                        const dist = dx * dx + dy * dy;
                        if (dist < minDist) {
                            minDist = dist;
                            nearestOpponent = other;
                        }
                    }

                    if (!nearestOpponent && alivePlayers.length > 1) {
                        for (let j = 0; j < alivePlayers.length; j++) {
                            const other = alivePlayers[j];
                            if (other === player) continue;
                            const dx =
                                other.body.position.x - player.body.position.x;
                            const dy =
                                other.body.position.y - player.body.position.y;
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

            // Determine Current King
            if (this.players.length > 0 && frameCount % 60 === 0) {
                const king = [...this.players].sort((a, b) => b.hp - a.hp)[0];
                this.currentKingId = king.id;
            }

            // Global Battle Timer: Always count down
            this.victoryTimer -= delta;

            const minBattleTime = 10000; // 10 seconds grace period
            const hasEnoughTimePassed =
                GAME_CONFIG.VICTORY_TIMER - this.victoryTimer > minBattleTime;
            const noMoreComing =
                this.queue.length === 0 && this.pendingSpawns.size === 0;

            // Trigger victory only if:
            // 1. Time is up
            // 2. OR: 1 player remains AND battle has started (had 2+ players) AND no more players are in queue
            if (
                this.victoryTimer <= 0 ||
                (hasEnoughTimePassed &&
                    noMoreComing &&
                    this.players.length === 1 &&
                    this.hasHadMultiplePlayers)
            ) {
                if (this.players.length > 0) {
                    // Pick the best player as winner (highest HP)
                    const winner = [...this.players].sort(
                        (a, b) => b.hp - a.hp,
                    )[0];
                    this.state = "gameover";
                    this.winner = winner.id;

                    // Add to history
                    this.winnersHistory.unshift({
                        name: winner.id,
                        avatarUrl: winner.avatarImg?.src || null,
                    });
                    if (this.winnersHistory.length > 5)
                        this.winnersHistory.pop();
                } else if (this.victoryTimer <= 0) {
                    this.state = "gameover";
                    this.winner = "NO ONE";
                }
            }
            logicTime = performance.now() - startLogic;

            // Cache particle count for perf log (avoids a second ECS query below)
            this._lastParticleCount = particleCount;

            // Periodic Cache Cleanup (Every 10 minutes)
            if (frameCount % 36000 === 0) {
                this.cleanUpCaches();
            }
        }

        this.shakeAmount *= 0.9;
        if (this.shakeAmount < 0.1) this.shakeAmount = 0;

        // RENDER
        const startRender = performance.now();
        this.render();
        renderTime = performance.now() - startRender;

        // Legacy HUD update (Disabled in favor of React HUD)
        /*
        if (Math.floor(timestamp / 16) % 10 === 0) {
            this.renderer.updateHUD(this);
        }
        */

        // PERFORMANCE LOGGING (Every 5 frames)
        this.frameCounter++;
        if (this.frameCounter % 5 === 0) {
            const memory = (performance as any).memory;
            this.perfHistory.push({
                t: Math.floor(timestamp),
                fps: this.fps,
                dt: parseFloat(delta.toFixed(2)),
                physics: parseFloat(physicsTime.toFixed(2)),
                logic: parseFloat(logicTime.toFixed(2)),
                render: parseFloat(renderTime.toFixed(2)),
                mem: memory
                    ? Math.round(memory.usedJSHeapSize / 1048576)
                    : undefined,
                players: this.players.length,
                particles: this._lastParticleCount, // cached — no extra ECS query
            });
            if (this.perfHistory.length > this.maxPerfEntries)
                this.perfHistory.shift();
        }

        requestAnimationFrame((t) => this.loop(t));
    }

    public downloadPerfLog() {
        const dataStr =
            "data:text/json;charset=utf-8," +
            encodeURIComponent(JSON.stringify(this.perfHistory, null, 2));
        const downloadAnchorNode = document.createElement("a");
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "perf_log.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        console.log("Performance log exported!");
    }

    private cleanUpCaches() {
        const now = Date.now();
        // Clear respawn cooldowns that are long gone
        for (const [id, time] of this.respawnCooldowns) {
            if (now > time + 600000) {
                // 10 minutes old
                this.respawnCooldowns.delete(id);
            }
        }

        // Clear userData/activeMembers for users who haven't been active for a long time
        // and aren't currently in the game. This prevents the map from growing to 100k+ entries.
        if (this.userData.size > 1000) {
            for (const id of this.userData.keys()) {
                if (
                    !this.tiktokUsers.has(id) &&
                    !this.queue.some((q) => q.name === id)
                ) {
                    this.userData.delete(id);
                    this.activeMembers.delete(id);
                }
            }
        }
    }

    render() {
        if (!this.assetsLoaded) return;
        this.renderer.render(this);
    }

    createHitEffect(x: number, y: number, colorId: number = 0) {
        this.shakeAmount = GAME_CONFIG.SHAKE_INTENSITY;
        // ECS particles are extremely fast, we can safely spawn more without FPS drop
        for (let i = 0; i < 8; i++) {
            const type = Math.random() > 0.8 ? 1 : 0;
            createParticle(x, y, colorId, type, 0.8 + Math.random() * 0.5);
        }
    }

    createDeathEffect(x: number, y: number) {
        // Screen shake
        this.shakeAmount = 12;

        // Shockwave (uses pool, very cheap)
        this.renderer.triggerShockwave(x, y);

        // Reduced particle burst: 10 instead of 45
        for (let i = 0; i < 10; i++) {
            const type = Math.random() > 0.6 ? 1 : 0;
            const colorIdx = Math.floor(Math.random() * 5);
            createParticle(x, y, colorIdx, type, 1.0 + Math.random(), 1.0 + Math.random());
        }
    }

    getPlayerColor(index: number) {
        const colors = GAME_CONFIG.PLAYER_COLORS;
        return colors[index % colors.length];
    }
}
