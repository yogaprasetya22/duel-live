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
    private arenaGlowGraphic: PIXI.Graphics;
    private gridSprite: PIXI.TilingSprite | null = null;
    private ambientParticles: PIXI.Graphics[] = [];
    private vignette: PIXI.Graphics | null = null;
    private scanlineSprite: PIXI.TilingSprite | null = null;
    private fpsText: PIXI.BitmapText | null = null;

    // Particle system
    private particleContainer: PIXI.Container;
    private particlePool: PIXI.Sprite[] = [];
    private particleTextures: PIXI.Texture[] = [];

    // Shockwave system
    private shockwaveContainer: PIXI.Container;
    private shockwavePool: PIXI.Sprite[] = [];
    private activeShockwaves: { sprite: PIXI.Sprite; life: number }[] = [];
    private shockwaveTexture: PIXI.Texture | null = null;

    // Floor Decals (Burn/Hit Marks)
    private decalContainer: PIXI.Container;
    private activeDecals: { sprite: PIXI.Sprite; life: number }[] = [];
    private decalPool: PIXI.Sprite[] = [];
    private decalTexture: PIXI.Texture | null = null;

    // King Aura (Floating Crown)
    private kingAuraContainer: PIXI.Container;
    private kingAuraSprite: PIXI.Sprite | null = null;

    // Screen effects
    private flashOverlay: PIXI.Graphics;
    private flashLife: number = 0;
    
    // Lightning system
    private lightningGraphic: PIXI.Graphics;
    private activeLightnings: { x1: number, y1: number, x2: number, y2: number, life: number }[] = [];

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
        this.shockwaveContainer = new PIXI.Container();
        this.decalContainer = new PIXI.Container();
        this.kingAuraContainer = new PIXI.Container();
        this.arenaGraphic = new PIXI.Graphics();
        this.arenaGlowGraphic = new PIXI.Graphics();
        this.flashOverlay = new PIXI.Graphics();
        this.lightningGraphic = new PIXI.Graphics();

        this.ready = this.init(canvas);
        window.addEventListener("resize", () => this.onResize());
    }

    private onResize() {
        if (!this.app.renderer) return;
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
        if (this.gridSprite) {
            this.gridSprite.width = window.innerWidth;
            this.gridSprite.height = window.innerHeight;
        }
        if (this.scanlineSprite) {
            this.scanlineSprite.width = window.innerWidth;
            this.scanlineSprite.height = window.innerHeight;
        }
        this.drawVignette();
    }

    private async init(canvas: HTMLCanvasElement) {
        await this.app.init({
            canvas: canvas,
            width: window.innerWidth,
            height: window.innerHeight,
            backgroundColor: GAME_CONFIG.BG_COLOR,
            antialias: window.innerWidth > 600, // Disable antialias on mobile for FPS boost
            resolution: Math.min(window.devicePixelRatio || 1, window.innerWidth < 600 ? 2 : 3), // Cap resolution on mobile
            autoDensity: true,
            roundPixels: true, // Faster rendering by rounding coordinates
        });

        this.app.stage.addChild(this.layers.bg);
        this.app.stage.addChild(this.layers.grid);
        this.app.stage.addChild(this.layers.particles);
        this.app.stage.addChild(this.layers.players);
        this.app.stage.addChild(this.layers.ui);
        this.app.stage.addChild(this.flashOverlay);

        this.layers.grid.addChild(this.arenaGlowGraphic);
        this.layers.grid.addChild(this.arenaGraphic);
        this.layers.grid.addChild(this.decalContainer); // Decals below players
        
        this.layers.particles.addChild(this.lightningGraphic);
        this.layers.players.addChild(this.kingAuraContainer); // Decals below players
        
        this.layers.players.addChildAt(this.kingAuraContainer, 0); // King aura behind players
        
        this.layers.particles.addChild(this.shockwaveContainer);
        this.layers.particles.addChild(this.particleContainer);

        // ── Grid Texture ──
        const gs = GAME_CONFIG.ARENA_GRID_SIZE;
        const ggp = new PIXI.Graphics()
            .rect(0, 0, gs, gs)
            .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
        const gridTex = this.app.renderer.generateTexture(ggp);
        ggp.destroy();

        this.gridSprite = new PIXI.TilingSprite({
            texture: gridTex,
            width: window.innerWidth,
            height: window.innerHeight,
        });
        this.gridSprite.alpha = GAME_CONFIG.GRID_ALPHA;
        this.layers.grid.addChildAt(this.gridSprite, 0);

        // ── Ambient Particles ──
        for (let i = 0; i < GAME_CONFIG.AMBIENT_PARTICLE_COUNT; i++) {
            const ap = new PIXI.Graphics().circle(0, 0, 1).fill(0xffffff);
            ap.x = Math.random() * window.innerWidth;
            ap.y = Math.random() * window.innerHeight;
            ap.alpha = Math.random() * 0.5;
            (ap as any).vx = (Math.random() - 0.5) * 0.5;
            (ap as any).vy = (Math.random() - 0.5) * 0.5;
            this.ambientParticles.push(ap);
            this.layers.bg.addChild(ap);
        }

        // ── Vignette ──
        this.vignette = new PIXI.Graphics();
        this.drawVignette();
        // Skip vignette on mobile for better performance
        if (window.innerWidth > 600) {
            this.app.stage.addChild(this.vignette);
        }

        // ── Scanlines ──
        const slg = new PIXI.Graphics()
            .rect(0, 0, 100, 4)
            .fill({ color: 0x000000, alpha: 0.2 });
        const scanlineTex = this.app.renderer.generateTexture(slg);
        slg.destroy();

        this.scanlineSprite = new PIXI.TilingSprite({
            texture: scanlineTex,
            width: window.innerWidth,
            height: window.innerHeight,
        });
        this.scanlineSprite.alpha = 0.5;
        // Only add scanlines on desktop to save GPU power on mobile
        if (window.innerWidth > 600) {
            this.app.stage.addChild(this.scanlineSprite);
        }

        // 1. Circle Texture
        const pg = new PIXI.Graphics().circle(0, 0, GAME_CONFIG.PARTICLE_SIZE).fill(0xffffff);
        this.particleTextures[0] = this.app.renderer.generateTexture(pg);
        pg.destroy();

        // 2. Spark/Line Texture
        const sg = new PIXI.Graphics()
            .rect(-GAME_CONFIG.PARTICLE_SIZE, -1, GAME_CONFIG.PARTICLE_SIZE * 3, 2)
            .fill(0xffffff);
        this.particleTextures[1] = this.app.renderer.generateTexture(sg);
        sg.destroy();

        // 3. Star/Diamond Texture
        const stg = new PIXI.Graphics()
            .poly([0, -5, 2, -2, 5, 0, 2, 2, 0, 5, -2, 2, -5, 0, -2, -2])
            .fill(0xffffff);
        this.particleTextures[2] = this.app.renderer.generateTexture(stg);
        stg.destroy();

        // Shockwave Texture
        const swg = new PIXI.Graphics()
            .circle(0, 0, 50)
            .stroke({ color: 0xffffff, width: 2 });
        this.shockwaveTexture = this.app.renderer.generateTexture(swg);
        swg.destroy();

        // Decal Texture (Crater/Burn)
        const dg = new PIXI.Graphics()
            .circle(0, 0, 15)
            .fill({ color: 0x000000, alpha: 0.6 })
            .circle(0, 0, 8)
            .fill({ color: 0xff3300, alpha: 0.8 });
        this.decalTexture = this.app.renderer.generateTexture(dg);
        dg.destroy();

        // King Aura (Crown) Texture
        const kag = new PIXI.Graphics()
            .poly([0, 0, -15, -15, -10, 0, 0, -25, 10, 0, 15, -15, 0, 0]) // Simple crown shape
            .fill({ color: 0xffd700 })
            .stroke({ color: 0xffa500, width: 2 });
        const kingAuraTex = this.app.renderer.generateTexture(kag);
        kag.destroy();
        this.kingAuraSprite = new PIXI.Sprite(kingAuraTex);
        this.kingAuraSprite.anchor.set(0.5, 1); // Anchor at bottom center
        this.kingAuraSprite.visible = false;
        this.kingAuraContainer.addChild(this.kingAuraSprite);

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
            resolution: window.devicePixelRatio || 1,
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
            resolution: window.devicePixelRatio || 1,
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
            resolution: window.devicePixelRatio || 1,
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
        for (let i = 0; i < 2000; i++) {
            const s = new PIXI.Sprite(this.particleTextures[0]);
            s.anchor.set(0.5);
            s.visible = false;
            this.particleContainer.addChild(s);
            this.particlePool.push(s);
        }

        // Pre-allocate shockwaves
        for (let i = 0; i < 20; i++) {
            const s = new PIXI.Sprite(this.shockwaveTexture!);
            s.anchor.set(0.5);
            s.visible = false;
            this.shockwaveContainer.addChild(s);
            this.shockwavePool.push(s);
        }

        // Pre-allocate decals
        for (let i = 0; i < 100; i++) {
            const s = new PIXI.Sprite(this.decalTexture!);
            s.anchor.set(0.5);
            s.visible = false;
            this.decalContainer.addChild(s);
            this.decalPool.push(s);
        }
    }


    public render(game: Game) {
        if (!this.app.renderer) return;

        // Draw lightnings
        this.lightningGraphic.clear();
        for (let i = this.activeLightnings.length - 1; i >= 0; i--) {
            const l = this.activeLightnings[i];
            l.life -= 0.15;
            if (l.life <= 0) {
                this.activeLightnings.splice(i, 1);
            } else {
                this.lightningGraphic.stroke({ width: 4, color: 0xffffff, alpha: l.life });
                this.lightningGraphic.moveTo(l.x1, l.y1);
                const midX = (l.x1 + l.x2) / 2 + (Math.random() - 0.5) * 40;
                const midY = (l.y1 + l.y2) / 2 + (Math.random() - 0.5) * 40;
                this.lightningGraphic.lineTo(midX, midY);
                this.lightningGraphic.lineTo(l.x2, l.y2);
            }
        }

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
                    
                    // CRITICAL: Explicitly destroy the avatar texture to prevent global PIXI cache leak
                    if (cache.avatarSprite && cache.avatarSprite.texture) {
                        cache.avatarSprite.texture.destroy(true); 
                    }
                    
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
        this.updateShockwaves();
        this.updateDecals();
        this.updateFlash();
        this.animateArena();
        this.updateKingAura(game);

        if (this.scanlineSprite) {
            this.scanlineSprite.tilePosition.y += 0.5; // Moving scanlines
        }
        if (this.fpsText) this.fpsText.text = `FPS: ${game.fps}`;
    }

    private animateArena() {
        // Animate Grid
        if (this.gridSprite) {
            this.gridSprite.tilePosition.x -= GAME_CONFIG.GRID_SPEED;
            this.gridSprite.tilePosition.y -= GAME_CONFIG.GRID_SPEED * 0.5;
            // Pulsing grid alpha
            this.gridSprite.alpha = GAME_CONFIG.GRID_ALPHA + Math.sin(Date.now() / 1000) * 0.05;
        }

        // Animate Ambient Particles
        for (const ap of this.ambientParticles) {
            ap.x += (ap as any).vx;
            ap.y += (ap as any).vy;
            if (ap.x < 0) ap.x = window.innerWidth;
            if (ap.x > window.innerWidth) ap.x = 0;
            if (ap.y < 0) ap.y = window.innerHeight;
            if (ap.y > window.innerHeight) ap.y = 0;
        }
    }

    public triggerLightning(fromX: number, fromY: number, toX: number, toY: number) {
        this.activeLightnings.push({
            x1: fromX, y1: fromY, x2: toX, y2: toY, life: 1.0
        });
        
        // Flash screen slightly
        this.triggerFlash(0.1);
    }

    public triggerFlash(intensity: number = 0.2) {
        this.flashLife = intensity;
    }

    public triggerShockwave(x: number, y: number) {
        // Find an inactive sprite from the pool
        const sprite = this.shockwavePool.find(s => !s.visible);
        if (sprite) {
            sprite.visible = true;
            sprite.x = x;
            sprite.y = y;
            sprite.scale.set(0.1);
            sprite.alpha = 0.8;
            this.activeShockwaves.push({ sprite, life: 1.0 });
        }
    }

    private updateFlash() {
        if (this.flashLife <= 0) {
            if (this.flashOverlay.visible) this.flashOverlay.visible = false;
            return;
        }

        this.flashOverlay.visible = true;
        this.flashOverlay.clear();
        this.flashOverlay
            .rect(0, 0, window.innerWidth, window.innerHeight)
            .fill({ color: 0xffffff, alpha: this.flashLife * 0.3 });
        
        this.flashLife -= GAME_CONFIG.FLASH_DECAY;
    }

    private updateShockwaves() {
        for (let i = this.activeShockwaves.length - 1; i >= 0; i--) {
            const sw = this.activeShockwaves[i];
            sw.life -= GAME_CONFIG.SHOCKWAVE_DECAY;
            
            if (sw.life <= 0) {
                sw.sprite.visible = false;
                this.activeShockwaves.splice(i, 1);
            } else {
                sw.sprite.scale.set(sw.sprite.scale.x + GAME_CONFIG.SHOCKWAVE_GROWTH / 50);
                sw.sprite.alpha = sw.life;
            }
        }
    }

    public drawDecal(x: number, y: number) {
        const sprite = this.decalPool.find(s => !s.visible);
        if (sprite) {
            sprite.visible = true;
            sprite.x = x;
            sprite.y = y;
            sprite.scale.set(0.5 + Math.random() * 0.5);
            sprite.rotation = Math.random() * Math.PI * 2;
            sprite.alpha = 0.8;
            this.activeDecals.push({ sprite, life: 1.0 });
        }
    }

    private updateDecals() {
        for (let i = this.activeDecals.length - 1; i >= 0; i--) {
            const dec = this.activeDecals[i];
            dec.life -= 0.002; // Fade very slowly
            if (dec.life <= 0) {
                dec.sprite.visible = false;
                this.activeDecals.splice(i, 1);
            } else {
                dec.sprite.alpha = dec.life * 0.8; // Max alpha 0.8
            }
        }
    }

    private updateKingAura(game: Game) {
        if (!this.kingAuraSprite || !game.currentKingId) {
            if (this.kingAuraSprite) this.kingAuraSprite.visible = false;
            return;
        }
        const king = game.players.find(p => p.id === game.currentKingId);
        if (king && !king.isDead) {
            this.kingAuraSprite.visible = true;
            this.kingAuraSprite.x = king.body.position.x;
            // Float above head
            const bob = Math.sin(Date.now() / 200) * 5;
            this.kingAuraSprite.y = king.body.position.y - king.radius - 25 + bob;
            this.kingAuraSprite.scale.set(king.radius / 35 * (1 + Math.sin(Date.now() / 400) * 0.1));
            this.kingAuraSprite.alpha = 0.9 + Math.sin(Date.now() / 300) * 0.1;
        } else {
            this.kingAuraSprite.visible = false;
        }
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
                // Ensure high quality scaling for avatars
                texture.source.scaleMode = 'linear';
                avatarSprite = new PIXI.Sprite(texture);
                avatarSprite.anchor.set(0.5);
                avatarSprite.width = player.radius * 2;
                avatarSprite.height = player.radius * 2;
                avatarContainer.addChild(avatarSprite);
            }

            // BitmapText: no per-update canvas redraws, single texture atlas for all chars
            const hpText = new PIXI.BitmapText({
                text: String(Math.ceil(player.hp)),
                style: { 
                    fontFamily: "OrbitronHUD", 
                    fontSize: window.innerWidth < 600 ? 11 : GAME_CONFIG.FONT_SIZE_HUD 
                },
            });
            hpText.anchor.set(0.5);

            const nameText = new PIXI.BitmapText({
                text: player.id.toUpperCase(),
                style: { 
                    fontFamily: "OrbitronName", 
                    fontSize: window.innerWidth < 600 ? 10 : GAME_CONFIG.FONT_SIZE_NAME // Responsive font size
                },
            });
            nameText.anchor.set(0.5);
            nameText.y = -player.radius - (window.innerWidth < 600 ? 10 : GAME_CONFIG.NAME_LABEL_OFFSET);

            const swordContainer = new PIXI.Container();

            bodyGroup.addChild(swordContainer);
            bodyGroup.addChild(avatarContainer); // Avatar below
            bodyGroup.addChild(glow); // Border on TOP
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

        // ── 1. PRESTIGE TIER COLOR & GLOW ───────────────────────────────────
        let glowTint = GAME_CONFIG.ARENA_COLOR;
        let glowAlpha = 1.0;
        let glowScaleMultiplier = 1.0;
        let blendMode: PIXI.BLEND_MODES = 'normal';

        if (player.isLegendary) {
            // RAINBOW PULSE (Legendary)
            const t = Date.now() / 500;
            const r = Math.sin(t) * 127 + 128;
            const g = Math.sin(t + 2) * 127 + 128;
            const b = Math.sin(t + 4) * 127 + 128;
            glowTint = (r << 16) | (g << 8) | b;
            glowScaleMultiplier = 1.2 + Math.sin(Date.now() / 150) * 0.15;
            blendMode = 'add';
        } else if (player.isEpic) {
            // PURPLE PULSE (Epic)
            glowTint = 0xff00ff;
            glowAlpha = 0.8 + Math.sin(Date.now() / 200) * 0.2;
            glowScaleMultiplier = 1.1 + Math.sin(Date.now() / 300) * 0.05;
            blendMode = 'add';
        } else if (player.isElite) {
            // CYAN GLOW (Elite)
            glowTint = 0x00e5ff;
            glowAlpha = 0.9;
            glowScaleMultiplier = 1.05;
        }

        // ── 2. HP-BASED STATE OVERRIDES ──────────────────────────────────────
        const isCritical = player.hp < 5; // Low absolute HP
        
        if (player.isHit) {
            glowTint = 0xff0000;
            glowAlpha = 1.0;
        } else if (isCritical) {
            // CRITICAL: Red Flickering
            if (Math.floor(Date.now() / 100) % 2 === 0) {
                glowTint = 0xff0000;
                glowAlpha = 1.0;
            } else {
                glowAlpha = 0.2;
            }
        } else if (player.hp > 100) {
            // OVERPOWERED: Brighter additive glow
            blendMode = 'add';
            glowAlpha = 1.0;
        }

        cache.glow.tint = glowTint;
        cache.glow.alpha = glowAlpha;
        cache.glow.blendMode = blendMode;

        // Only update sizes when radius actually changes or for pulsing
        const targetGlowSize = (player.radius + (player.isLegendary ? 15 : 10)) * 2 * glowScaleMultiplier;
        cache.glow.width = cache.glow.height = targetGlowSize;

        if (cache.lastRadius !== player.radius) {
            cache.lastRadius = player.radius;

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
                // Prestige Sword Colors
                if (player.isLegendary) {
                    sprite.tint = 0xffffff; // Pure white glow (Legendary)
                    sprite.blendMode = 'add';
                    sprite.alpha = 0.8 + Math.sin(Date.now() / 100) * 0.2;
                } else if (player.isEpic) {
                    sprite.tint = 0xff00ff; // Neon magenta (Epic)
                    sprite.blendMode = 'add';
                    sprite.alpha = 1.0;
                } else if (player.isElite) {
                    sprite.tint = 0x00e5ff; // Cyan (Elite)
                    sprite.blendMode = 'add';
                    sprite.alpha = 1.0;
                } else {
                    sprite.tint = 0xffffff;
                    sprite.blendMode = 'normal';
                    sprite.alpha = 1.0;
                }

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
        if (this.particlePool.length < count) {
            const needed = count - this.particlePool.length;
            for(let i=0; i<needed; i++) {
                const s = new PIXI.Sprite(this.particleTextures[0]);
                s.anchor.set(0.5);
                this.particleContainer.addChild(s);
                this.particlePool.push(s);
            }
        }

        // Hot path: Only loop through what is necessary
        for (let i = 0; i < this.particlePool.length; i++) {
            const s = this.particlePool[i];
            if (i < count) {
                const eid = ents[i];
                s.visible = true;
                s.x = Position.x[eid];
                s.y = Position.y[eid];
                
                const lifePct = ParticleState.life[eid] / ParticleState.maxLife[eid];
                s.alpha = lifePct;
                s.tint = PARTICLE_COLOR_LUT[ParticleState.colorId[eid]] ?? 0xffffff;
                
                // New visual properties
                const type = ParticleState.typeId[eid];
                s.texture = this.particleTextures[type] || this.particleTextures[0];
                s.rotation = ParticleState.rotation[eid];
                s.scale.set(ParticleState.scale[eid] * lifePct);

                // Add additive blending for premium look
                s.blendMode = 'add';
            } else {
                if (s.visible) s.visible = false; 
                else break; 
            }
        }
    }

    private setupHUDLayout() {
        // Disabled: HUD is now handled by React
    }

    public updateHUD() {
        // HUD is now handled by React in main.tsx
    }

    public drawArena(x: number, y: number, w: number, h: number) {
        // Dirty-check: skip redraw if arena hasn't moved/resized
        const key = `${x},${y},${w},${h}`;
        if (key === this.lastArenaKey) return;
        this.lastArenaKey = key;

        // Draw Main Border
        this.arenaGraphic.clear();
        this.arenaGraphic
            .rect(x, y, w, h)
            .stroke({ width: GAME_CONFIG.ARENA_STROKE, color: GAME_CONFIG.ARENA_COLOR });

        // Draw Neon Glow Border
        this.arenaGlowGraphic.clear();
        this.arenaGlowGraphic
            .rect(x - 2, y - 2, w + 4, h + 4)
            .stroke({ 
                width: GAME_CONFIG.ARENA_STROKE * 3, 
                color: GAME_CONFIG.ARENA_COLOR, 
                alpha: 0.3 
            });
    }

    private drawVignette() {
        if (!this.vignette) return;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.vignette.clear();
        
        // Very subtle dark vignette for cinematic feel
        this.vignette.fill({ color: 0x000000, alpha: 0.1 });
        this.vignette.rect(0, 0, w, h);
        
        // Simple radial cut (not a true gradient, but gives the focus effect in PIXI)
        // For a better vignette we'd use a sprite/texture, but Graphics is faster to implement now
        // We'll just leave it as a slight darkening overlay for now or skip if too complex without assets
    }

    clear() {}
    drawObstacle() {}
}
