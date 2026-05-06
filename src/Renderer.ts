import * as PIXI from "pixi.js";
import type { Game } from "./Game";
import { Player } from "./Player";
import { query } from "bitecs";
import { world, Position, ParticleState } from "./ECS";
import { GAME_CONFIG } from "./Config";
import { InstancedParticleRenderer } from "./InstancedParticleRenderer";

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
// (Particle colors are now handled by InstancedParticleRenderer)

export class Renderer {
    public app: PIXI.Application;
    public ready: Promise<void>;

    // ── View cache: direct refs instead of Map<id, Container> + getChildByLabel
    private viewCache: Map<string, PlayerViewCache> = new Map();

    private arenaGraphic: PIXI.Graphics;
    private hudGraphic: PIXI.Graphics;
    private fpsText: PIXI.BitmapText | null = null;
    private bgVideoSprite: PIXI.Sprite | null = null;

    // Particle system
    private instancedParticleRenderer: InstancedParticleRenderer | null = null;

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

        this.instancedParticleRenderer = new InstancedParticleRenderer(20000);
        this.arenaGraphic = new PIXI.Graphics();
        this.hudGraphic = new PIXI.Graphics();

        this.ready = this.init(canvas);
        window.addEventListener("resize", () => this.onResize());
    }

    private onResize() {
        if (!this.app.renderer) return;
        this.app.renderer.resize(window.innerWidth, window.innerHeight);
        if (this.bgVideoSprite) {
            this.bgVideoSprite.width = this.app.screen.width;
            this.bgVideoSprite.height = this.app.screen.height;
        }
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
        if (this.instancedParticleRenderer) {
            this.layers.particles.addChild(this.instancedParticleRenderer.displayObject);
        }
        this.layers.ui.addChild(this.hudGraphic);

        const gg = new PIXI.Graphics()
            .circle(0, 0, 60)
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

        this.setupVideoBackground();
    }

    private async setupVideoBackground() {
        try {
            const texture = await PIXI.Assets.load({
                src: "/bg.mp4",
                loadParser: "loadVideo",
            });
            this.bgVideoSprite = new PIXI.Sprite(texture);
            this.bgVideoSprite.width = this.app.screen.width;
            this.bgVideoSprite.height = this.app.screen.height;
            const source = texture.source.resource as HTMLVideoElement;
            source.loop = true;
            source.muted = true;
            source.play();
            this.layers.bg.addChild(this.bgVideoSprite);
        } catch (e) {
            console.error(e);
        }
    }

    public render(game: Game) {
        if (!this.app.renderer) return;

        // Arena: only redraw when arena dimensions actually changed
        this.drawArena(game.arenaX, game.arenaY, game.arenaW, game.arenaH);

        const playerCount = game.players.length;
        const activeIds = new Set<string>();

        for (let i = 0; i < playerCount; i++) {
            const player = game.players[i];
            if (player.isDead) continue;
            activeIds.add(player.id);
            this.updatePlayerView(player);
        }

        // Remove dead/gone players
        const toDelete: string[] = [];
        this.viewCache.forEach((_, id) => {
            if (!activeIds.has(id)) toDelete.push(id);
        });
        for (const id of toDelete) {
            const cache = this.viewCache.get(id);
            if (cache) {
                this.layers.players.removeChild(cache.view);
                cache.view.destroy({ children: true });
                this.viewCache.delete(id);
            }
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
        const knifeParts = player.knifeParts;
        const localPositions = player.knifeLocalPositions;
        const localAngles = player.knifeLocalAngles;
        const swordContainer = cache.swordContainer;

        // Add sprites only when swordCount increases (rare event)
        while (cache.swordSprites.length < knifeParts.length) {
            if (player.knifeImg) {
                const sprite = new PIXI.Sprite(
                    PIXI.Texture.from(player.knifeImg),
                );
                sprite.anchor.set(0.5);
                swordContainer.addChild(sprite);
                cache.swordSprites.push(sprite);
            } else break;
        }

        // Remove if count ever decreases
        while (cache.swordSprites.length > knifeParts.length) {
            const s = cache.swordSprites.pop()!;
            swordContainer.removeChild(s);
            s.destroy();
        }

        const targetH = GAME_CONFIG.KNIFE_HEIGHT * (player.radius / GAME_CONFIG.PLAYER_RADIUS);
        const radiusChanged =
            cache.lastSwordCount !== knifeParts.length ||
            cache.lastMaskRadius !== player.radius;

        for (let i = 0; i < knifeParts.length; i++) {
            const sprite = cache.swordSprites[i];
            sprite.position.set(localPositions[i].x, localPositions[i].y);
            sprite.rotation = localAngles[i];

            // Height/scale update only needed when radius changes
            if (radiusChanged) {
                sprite.height = targetH;
                sprite.scale.x = sprite.scale.y;
            }
        }

        if (radiusChanged) {
            cache.lastSwordCount = knifeParts.length;
            cache.lastMaskRadius = player.radius;
        }
    }

    private updateParticles() {
        if (!this.instancedParticleRenderer) return;
        const ents = query(world, [Position, ParticleState]);
        this.instancedParticleRenderer.update(ents);
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
