import * as PIXI from "pixi.js";
import type { Game } from "./Game";
import { Player } from "./Player";
import { query } from "bitecs";
import { world, Position, ParticleState, PARTICLE_COLORS } from "./ECS";
import { GAME_CONFIG } from "./Config";

// ─── Cached references per player view ───────────────────────────────────────
// Storing direct object references eliminates ALL getChildByLabel() calls in the
// hot render path. getChildByLabel is O(n) on the children array every call.
interface PlayerViewCache {
    view: PIXI.Container;
    bodyGroup: PIXI.Container;
    hudGroup: PIXI.Container;
    glow: PIXI.Sprite;
    avatarContainer: PIXI.Container;
    avatarSprite: PIXI.Sprite | null;
    mask: PIXI.Graphics;
    hpText: PIXI.BitmapText;
    nameText: PIXI.BitmapText;
    swordContainer: PIXI.Container;
    swordSprites: PIXI.Sprite[];
    // Track last rendered values to skip unnecessary GPU uploads
    lastHp: number;
    lastRadius: number;
    lastSwordCount: number;
    lastMaskRadius: number;
}

// Pre-parsed color LUT: avoids parseInt + string replace every particle frame
const PARTICLE_COLOR_LUT: number[] = PARTICLE_COLORS.map((c) =>
    parseInt(c.replace("#", ""), 16),
);

export class Renderer {
    public app: PIXI.Application;
    public ready: Promise<void>;

    // ── View cache: direct refs instead of Map<id, Container> + getChildByLabel
    private viewCache: Map<string, PlayerViewCache> = new Map();

    private arenaGraphic: PIXI.Graphics;
    private hudGraphic: PIXI.Graphics;
    private fpsText: PIXI.BitmapText | null = null;
    private leaderboardContainer: PIXI.Container;
    private queueContainer: PIXI.Container;
    private lbLines: PIXI.BitmapText[] = [];
    private qLines: PIXI.BitmapText[] = [];

    // Particle system
    private particleContainer: PIXI.Container;
    private particlePool: PIXI.Sprite[] = [];
    private particleTexture: PIXI.Texture | null = null;

    // Texture cache
    private glowTexture: PIXI.Texture | null = null;

    // Arena dirty flag: only redraw when dimensions change
    private lastArenaKey: string = "";

    // Sort throttle: sort y-order every N frames (not every frame)
    private sortFrameCounter: number = 0;
    private readonly SORT_INTERVAL = GAME_CONFIG.SORT_INTERVAL;

    private layers: {
        bg: PIXI.Container;
        grid: PIXI.Container;
        particles: PIXI.Container;
        players: PIXI.Container;
        ui: PIXI.Container;
    };

    constructor(canvas: HTMLCanvasElement) {
        this.app = new PIXI.Application();
        this.layers = {
            bg: new PIXI.Container(),
            grid: new PIXI.Container(),
            particles: new PIXI.Container(),
            players: new PIXI.Container(),
            ui: new PIXI.Container(),
        };

        this.particleContainer = new PIXI.Container();
        this.arenaGraphic = new PIXI.Graphics();
        this.hudGraphic = new PIXI.Graphics();
        this.leaderboardContainer = new PIXI.Container();
        this.queueContainer = new PIXI.Container();

        this.ready = this.init(canvas);
        window.addEventListener("resize", () => this.onResize());
    }

    private onResize() {
        if (!this.app.renderer) return;
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
    }

    private async init(canvas: HTMLCanvasElement) {
        await this.app.init({
            canvas: canvas,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: GAME_CONFIG.BG_COLOR,
            antialias: false,
            resolution: 1,
            autoDensity: true,
        });

        this.app.stage.addChild(this.layers.bg);
        this.app.stage.addChild(this.layers.grid);
        this.app.stage.addChild(this.layers.particles);
        this.app.stage.addChild(this.layers.players);
        this.app.stage.addChild(this.layers.ui);

        this.layers.grid.addChild(this.arenaGraphic);
        this.layers.particles.addChild(this.particleContainer);
        this.layers.ui.addChild(this.hudGraphic);
        this.layers.ui.addChild(this.leaderboardContainer);
        this.layers.ui.addChild(this.queueContainer);

        const pg = new PIXI.Graphics().circle(0, 0, GAME_CONFIG.PARTICLE_SIZE).fill(0xffffff);
        this.particleTexture = this.app.renderer.generateTexture(pg);
        pg.destroy();

        const gg = new PIXI.Graphics()
            .circle(0, 0, 50)
            .stroke({ color: 0xffffff, width: GAME_CONFIG.GLOW_STROKE });
        this.glowTexture = this.app.renderer.generateTexture(gg);
        gg.destroy();

        // ── Install BitmapFont once for the entire session ──────────────────
        // BitmapText renders from a pre-built texture atlas: updating 1000 labels
        // is ~10x faster than PIXI.Text because no per-update canvas draw happens.
        PIXI.BitmapFont.install({
            name: "OrbitronHUD",
            style: {
                fontFamily: GAME_CONFIG.FONT_FAMILY,
                fontSize: 32, // high base size; we'll scale down with BitmapText.scale
                fill: 0xffffff,
                fontWeight: "900",
                stroke: { color: 0x000000, width: GAME_CONFIG.FONT_STROKE_WIDTH },
            },
            chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:/ ",
            resolution: 1,
        });

        PIXI.BitmapFont.install({
            name: "OrbitronName",
            style: {
                fontFamily: GAME_CONFIG.FONT_FAMILY,
                fontSize: 32,
                fill: 0x00e5ff,
                fontWeight: "900",
                stroke: { color: 0x000000, width: GAME_CONFIG.FONT_STROKE_WIDTH },
            },
            chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.:/ _-",
            resolution: 1,
        });

        PIXI.BitmapFont.install({
            name: "OrbitronFPS",
            style: {
                fontFamily: GAME_CONFIG.FONT_FAMILY,
                fontSize: 32,
                fill: 0x00ff41,
                fontWeight: "900",
                stroke: { color: 0x000000, width: GAME_CONFIG.FONT_STROKE_WIDTH },
            },
            chars: "FPS:0123456789 ",
            resolution: 1,
        });

        this.fpsText = new PIXI.BitmapText({
            text: "FPS: 60",
            style: { fontFamily: "OrbitronFPS", fontSize: GAME_CONFIG.FONT_SIZE_FPS },
        });
        this.fpsText.position.set(20, 20);
        this.layers.ui.addChild(this.fpsText);

        // Pre-allocate Leaderboard & Queue Lines
        this.setupHUDLayout();

        // Pre-allocate particles to avoid frame spikes
        for (let i = 0; i < 500; i++) {
            const s = new PIXI.Sprite(this.particleTexture!);
            s.anchor.set(0.5);
            s.visible = false;
            this.particleContainer.addChild(s);
            this.particlePool.push(s);
        }
    }


    public render(game: Game) {
        if (!this.app.renderer) return;

        // Arena: only redraw when arena dimensions actually changed
        this.drawArena(game.arenaX, game.arenaY, game.arenaW, game.arenaH);

        const playerCount = game.players.length;
        for (let i = 0; i < playerCount; i++) {
            const player = game.players[i];
            if (player.isDead) continue;
            this.updatePlayerView(player);
        }

        // Remove dead/gone players - O(n) scan without allocating a Set
        if (this.viewCache.size > playerCount) {
            this.viewCache.forEach((cache, id) => {
                // O(1) lookup via tiktokUsers map rather than building a new Set
                if (!game.tiktokUsers.has(id)) {
                    this.layers.players.removeChild(cache.view);
                    cache.view.destroy({ children: true });
                    this.viewCache.delete(id);
                }
            });
        }

        // Y-sort throttled: sorting 1000 items every frame is O(n log n) wasted work.
        // Players move smoothly so sorting every 3 frames is imperceptible.
        this.sortFrameCounter++;
        if (this.sortFrameCounter >= this.SORT_INTERVAL) {
            this.sortFrameCounter = 0;
            this.layers.players.children.sort((a, b) => a.y - b.y);
        }

        this.updateParticles();
        if (this.fpsText) this.fpsText.text = `FPS: ${game.fps}`;
    }

    private updatePlayerView(player: Player) {
        let cache = this.viewCache.get(player.id);

        if (!cache) {
            // ── Build view once, store ALL refs in cache ──────────────────
            const view = new PIXI.Container();
            const bodyGroup = new PIXI.Container();
            const hudGroup = new PIXI.Container();

            const glow = new PIXI.Sprite(this.glowTexture!);
            glow.anchor.set(0.5);

            // Mask via Graphics, but we'll use scale to resize it instead of
            // redrawing every frame. Drawing at radius=1, then scale = player.radius.
            const mask = new PIXI.Graphics().circle(0, 0, 1).fill(0xffffff);
            mask.scale.set(player.radius);

            const avatarContainer = new PIXI.Container();
            avatarContainer.addChild(mask);
            avatarContainer.mask = mask;

            let avatarSprite: PIXI.Sprite | null = null;
            if (player.avatarImg) {
                const texture = PIXI.Texture.from(player.avatarImg);
                avatarSprite = new PIXI.Sprite(texture);
                avatarSprite.anchor.set(0.5);
                avatarSprite.width = player.radius * 2;
                avatarSprite.height = player.radius * 2;
                avatarContainer.addChild(avatarSprite);
            }

            // BitmapText: no per-update canvas redraws, single texture atlas for all chars
            const hpText = new PIXI.BitmapText({
                text: String(Math.ceil(player.hp)),
                style: { fontFamily: "OrbitronHUD", fontSize: GAME_CONFIG.FONT_SIZE_HUD },
            });
            hpText.anchor.set(0.5);

            const nameText = new PIXI.BitmapText({
                text: player.id.toUpperCase(),
                style: { fontFamily: "OrbitronName", fontSize: GAME_CONFIG.FONT_SIZE_NAME },
            });
            nameText.anchor.set(0.5);
            nameText.y = -player.radius - GAME_CONFIG.NAME_LABEL_OFFSET;

            const swordContainer = new PIXI.Container();

            bodyGroup.addChild(swordContainer);
            bodyGroup.addChild(glow);
            bodyGroup.addChild(avatarContainer);
            hudGroup.addChild(hpText);
            hudGroup.addChild(nameText);
            view.addChild(bodyGroup);
            view.addChild(hudGroup);

            this.layers.players.addChild(view);

            cache = {
                view,
                bodyGroup,
                hudGroup,
                glow,
                avatarContainer,
                avatarSprite,
                mask,
                hpText,
                nameText,
                swordContainer,
                swordSprites: [],
                lastHp: -1,
                lastRadius: -1,
                lastSwordCount: 0,
                lastMaskRadius: -1,
            };
            this.viewCache.set(player.id, cache);
        }

        // ── Hot path: direct property access, ZERO getChildByLabel calls ──

        cache.view.position.set(player.body.position.x, player.body.position.y);
        cache.bodyGroup.rotation = player.body.angle;

        // Glow tint
        let tint = GAME_CONFIG.ARENA_COLOR;
        if (player.isHit) tint = 0xff0000;
        else if ((player as any).healFlashTimer > 0) tint = 0x00ff00;
        cache.glow.tint = tint;

        // Only update sizes when radius actually changes (grow events are rare)
        if (cache.lastRadius !== player.radius) {
            cache.lastRadius = player.radius;

            cache.glow.width = cache.glow.height = player.radius * 2;

            if (cache.avatarSprite) {
                cache.avatarSprite.width = player.radius * 2;
                cache.avatarSprite.height = player.radius * 2;
            }

            // Resize mask via scale — no Graphics redraw, just a matrix update
            cache.mask.scale.set(player.radius);

            // Reposition name label
            cache.nameText.y = -player.radius - GAME_CONFIG.NAME_LABEL_OFFSET;

            // Scale BitmapText instead of changing fontSize (avoids font atlas rebuild)
            const hpScale = Math.max(GAME_CONFIG.FONT_SIZE_HUD, player.radius * 0.5) / GAME_CONFIG.FONT_SIZE_HUD;
            cache.hpText.scale.set(hpScale);
            const nameScale = Math.max(GAME_CONFIG.FONT_SIZE_NAME, player.radius * 0.45) / GAME_CONFIG.FONT_SIZE_NAME;
            cache.nameText.scale.set(nameScale);
        }

        // HP text: only update string when value changed
        const hpVal = Math.ceil(player.hp);
        if (cache.lastHp !== hpVal) {
            cache.lastHp = hpVal;
            cache.hpText.text = String(hpVal);
        }

        // Sword sprites
        this.updateSwords(cache, player);
    }

    private updateSwords(cache: PlayerViewCache, player: Player) {
        const localPositions = player.knifeLocalPositions;
        const localAngles = player.knifeLocalAngles;
        const swordContainer = cache.swordContainer;
        const maxSwords = GAME_CONFIG.MAX_SWORDS;

        // Pre-allocate sprites up to MAX_SWORDS once
        while (cache.swordSprites.length < maxSwords) {
            if (player.knifeImg) {
                const sprite = new PIXI.Sprite(PIXI.Texture.from(player.knifeImg));
                sprite.anchor.set(0.5);
                swordContainer.addChild(sprite);
                cache.swordSprites.push(sprite);
            } else break;
        }

        const targetH = GAME_CONFIG.KNIFE_HEIGHT * (player.radius / GAME_CONFIG.PLAYER_RADIUS);
        const radiusChanged = cache.lastMaskRadius !== player.radius;

        for (let i = 0; i < maxSwords; i++) {
            const sprite = cache.swordSprites[i];
            if (!sprite) continue;

            // Visibility based on symmetrically active slots
            const isActive = player.activeSwordSlots[i];
            sprite.visible = isActive;

            if (isActive) {
                sprite.position.set(localPositions[i].x, localPositions[i].y);
                sprite.rotation = localAngles[i];

                if (radiusChanged) {
                    sprite.height = targetH;
                    sprite.scale.x = sprite.scale.y;
                }
            }
        }

        if (radiusChanged) {
            cache.lastMaskRadius = player.radius;
        }
    }

    private updateParticles() {
        const ents = query(world, [Position, ParticleState]);
        const count = ents.length;

        // Ensure pool is large enough
        while (this.particlePool.length < count) {
            const s = new PIXI.Sprite(this.particleTexture!);
            s.anchor.set(0.5);
            this.particleContainer.addChild(s);
            this.particlePool.push(s);
        }

        // Hot path: Only loop through what is necessary
        for (let i = 0; i < this.particlePool.length; i++) {
            const s = this.particlePool[i];
            if (i < count) {
                const eid = ents[i];
                s.visible = true;
                s.x = Position.x[eid];
                s.y = Position.y[eid];
                s.alpha = ParticleState.life[eid] / ParticleState.maxLife[eid];
                s.tint = PARTICLE_COLOR_LUT[ParticleState.colorId[eid]] ?? 0xffffff;
            } else {
                if (s.visible) s.visible = false; // Only set if state changes
                else break; // Since we fill pool sequentially, we can break early
            }
        }
    }

    private setupHUDLayout() {
        const margin = 20;
        
        // Leaderboard (Top Right)
        this.leaderboardContainer.x = window.innerWidth - 300;
        this.leaderboardContainer.y = margin;
        
        const lbTitle = new PIXI.BitmapText({
            text: "TOP WARRIORS",
            style: { fontFamily: "OrbitronHUD", fontSize: 24, fill: 0xffcc00 }
        });
        this.leaderboardContainer.addChild(lbTitle);

        for (let i = 0; i < 5; i++) {
            const line = new PIXI.BitmapText({
                text: "",
                style: { fontFamily: "OrbitronHUD", fontSize: 18 }
            });
            line.y = 40 + i * 25;
            this.lbLines.push(line);
            this.leaderboardContainer.addChild(line);
        }

        // Queue (Bottom Left)
        this.queueContainer.x = margin;
        this.queueContainer.y = window.innerHeight - 180;

        const qTitle = new PIXI.BitmapText({
            text: "WAITING LIST",
            style: { fontFamily: "OrbitronHUD", fontSize: 20, fill: 0x00e5ff }
        });
        this.queueContainer.addChild(qTitle);

        for (let i = 0; i < 5; i++) {
            const line = new PIXI.BitmapText({
                text: "",
                style: { fontFamily: "OrbitronHUD", fontSize: 16 }
            });
            line.y = 30 + i * 22;
            this.qLines.push(line);
            this.queueContainer.addChild(line);
        }
    }

    public updateHUD(game: Game) {
        // Sort top-5 without copying the whole array (insertion sort over small slice)
        const players = game.players;
        const topPlayers: typeof players = [];
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            // Insertion-sort into topPlayers (max 5 entries, extremely cheap)
            let inserted = false;
            for (let j = 0; j < topPlayers.length; j++) {
                if (p.hp > topPlayers[j].hp) {
                    topPlayers.splice(j, 0, p);
                    if (topPlayers.length > 5) topPlayers.pop();
                    inserted = true;
                    break;
                }
            }
            if (!inserted && topPlayers.length < 5) topPlayers.push(p);
        }

        for (let i = 0; i < 5; i++) {
            const line = this.lbLines[i];
            const p = topPlayers[i];
            if (p) {
                line.text = `${i + 1}. ${p.id.toUpperCase()} - HP:${Math.ceil(p.hp)}`;
                line.visible = true;
            } else {
                line.visible = false;
            }
        }

        // Update Queue
        const q = game.queue;
        for (let i = 0; i < 5; i++) {
            const line = this.qLines[i];
            const entry = q[i];
            if (entry) {
                line.text = `NEXT: ${entry.name.toUpperCase()}`;
                line.visible = true;
            } else {
                line.visible = false;
            }
        }

        // Auto-reposition on window size change (lazy check)
        this.leaderboardContainer.x = window.innerWidth - 300;
        this.queueContainer.y = window.innerHeight - 180;
    }

    public drawArena(x: number, y: number, w: number, h: number) {
        // Dirty-check: skip redraw if arena hasn't moved/resized
        const key = `${x},${y},${w},${h}`;
        if (key === this.lastArenaKey) return;
        this.lastArenaKey = key;

        this.arenaGraphic.clear();
        this.arenaGraphic
            .rect(x, y, w, h)
            .stroke({ width: GAME_CONFIG.ARENA_STROKE, color: GAME_CONFIG.ARENA_COLOR });
    }

    clear() {}
    drawObstacle() {}
}
