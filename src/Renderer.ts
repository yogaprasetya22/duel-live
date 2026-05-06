import * as PIXI from 'pixi.js';
import type { Game } from './Game';
import { Player } from './Player';
import { query } from 'bitecs';
import { world, Position, ParticleState, PARTICLE_COLORS } from './ECS';

export class Renderer {
    public app: PIXI.Application;
    public ready: Promise<void>;
    private playerViews: Map<string, PIXI.Container> = new Map();
    private arenaGraphic: PIXI.Graphics;
    private hudGraphic: PIXI.Graphics;
    private fpsText: PIXI.Text | null = null;
    private bgVideoSprite: PIXI.Sprite | null = null;
    
    // Extreme Performance: Particle System
    private particleContainer: PIXI.Container;
    private particlePool: PIXI.Sprite[] = [];
    private particleTexture: PIXI.Texture | null = null;
    
    // Texture Caching for massive GPU speedup
    private glowTexture: PIXI.Texture | null = null;
    
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
        
        this.ready = this.init(canvas);
        window.addEventListener('resize', () => this.onResize());
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
            backgroundColor: 0x00050a,
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

        const pg = new PIXI.Graphics().circle(0, 0, 4).fill(0xffffff);
        this.particleTexture = this.app.renderer.generateTexture(pg);
        pg.destroy();

        const gg = new PIXI.Graphics().circle(0, 0, 50).stroke({ color: 0xffffff, width: 8 });
        this.glowTexture = this.app.renderer.generateTexture(gg);
        gg.destroy();

        this.fpsText = new PIXI.Text({
            text: "FPS: 60",
            style: { fontFamily: 'Orbitron', fontSize: 16, fill: 0x00ff41, fontWeight: '900', stroke: { color: 0x000000, width: 4 } }
        });
        this.fpsText.position.set(20, 20);
        this.layers.ui.addChild(this.fpsText);

        this.setupVideoBackground();
    }

    private async setupVideoBackground() {
        try {
            const texture = await PIXI.Assets.load({ src: '/bg.mp4', loadParser: 'loadVideo' });
            this.bgVideoSprite = new PIXI.Sprite(texture);
            this.bgVideoSprite.width = this.app.screen.width;
            this.bgVideoSprite.height = this.app.screen.height;
            const source = texture.source.resource as HTMLVideoElement;
            source.loop = true;
            source.muted = true;
            source.play();
            this.layers.bg.addChild(this.bgVideoSprite);
        } catch (e) { console.error(e); }
    }

    public render(game: Game) {
        if (!this.app.renderer) return;

        this.drawArena(game.arenaX, game.arenaY, game.arenaW, game.arenaH);

        const playerCount = game.players.length;
        const activeIds = new Set<string>();

        for (let i = 0; i < playerCount; i++) {
            const player = game.players[i];
            if (player.isDead) continue;
            activeIds.add(player.id);
            this.updatePlayerView(player);
        }

        const toDelete: string[] = [];
        this.playerViews.forEach((_, id) => { if (!activeIds.has(id)) toDelete.push(id); });
        for (const id of toDelete) {
            const view = this.playerViews.get(id);
            if (view) {
                this.layers.players.removeChild(view);
                view.destroy({ children: true });
                this.playerViews.delete(id);
            }
        }

        this.layers.players.children.sort((a, b) => a.y - b.y);

        this.updateParticles();
        if (this.fpsText) this.fpsText.text = `FPS: ${game.fps}`;
    }

    private updatePlayerView(player: Player) {
        let view = this.playerViews.get(player.id);
        
        if (!view) {
            view = new PIXI.Container();
            const bodyGroup = new PIXI.Container();
            bodyGroup.label = "bodyGroup";
            const hudGroup = new PIXI.Container();
            hudGroup.label = "hudGroup";
            
            const glow = new PIXI.Sprite(this.glowTexture!);
            glow.anchor.set(0.5);
            glow.label = "glow";
            
            const avatarContainer = new PIXI.Container();
            avatarContainer.label = "avatarContainer";
            const mask = new PIXI.Graphics().circle(0, 0, player.radius).fill(0xffffff);
            mask.label = "mask";
            avatarContainer.addChild(mask);
            avatarContainer.mask = mask;
            
            if (player.avatarImg) {
                const texture = PIXI.Texture.from(player.avatarImg);
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.label = "avatarSprite";
                avatarContainer.addChild(sprite);
            }
            
            const hpText = new PIXI.Text({
                text: "10",
                style: { fontFamily: 'Orbitron', fontSize: 14, fill: 0xffffff, fontWeight: '900', stroke: { color: 0x000000, width: 4 } }
            });
            hpText.label = "hpText";
            hpText.anchor.set(0.5);

            const nameText = new PIXI.Text({
                text: player.id.toUpperCase(),
                style: { fontFamily: 'Orbitron', fontSize: 14, fill: 0x00e5ff, fontWeight: '900', stroke: { color: 0x000000, width: 4 } }
            });
            nameText.label = "nameText";
            nameText.anchor.set(0.5);

            bodyGroup.addChild(glow);
            bodyGroup.addChild(avatarContainer);
            hudGroup.addChild(hpText);
            hudGroup.addChild(nameText);
            view.addChild(bodyGroup);
            view.addChild(hudGroup);
            
            this.layers.players.addChild(view);
            this.playerViews.set(player.id, view);
        }

        view.position.set(player.body.position.x, player.body.position.y);
        
        const bodyGroup = view.getChildByLabel("bodyGroup") as PIXI.Container;
        bodyGroup.rotation = player.body.angle;

        const hudGroup = view.getChildByLabel("hudGroup") as PIXI.Container;
        const glow = bodyGroup.getChildByLabel("glow") as PIXI.Sprite;
        
        let tint = 0x00ff41;
        if (player.isHit) tint = 0xff0000;
        else if ((player as any).healFlashTimer > 0) tint = 0x00ff00;
        glow.tint = tint;
        glow.width = glow.height = (player.radius + 4) * 2;

        const avatarContainer = bodyGroup.getChildByLabel("avatarContainer") as PIXI.Container;
        const avatarSprite = avatarContainer.getChildByLabel("avatarSprite") as PIXI.Sprite;
        const mask = avatarContainer.getChildByLabel("mask") as PIXI.Graphics;

        // Update sizes if grown
        if (avatarSprite) {
            avatarSprite.width = player.radius * 2;
            avatarSprite.height = player.radius * 2;
        }
        mask.clear().circle(0, 0, player.radius).fill(0xffffff);

        const hpText = hudGroup.getChildByLabel("hpText") as PIXI.Text;
        const nameText = hudGroup.getChildByLabel("nameText") as PIXI.Text;

        const hpVal = Math.ceil(player.hp).toString();
        if (hpText.text !== hpVal) hpText.text = hpVal;
        
        hpText.style.fontSize = Math.max(14, player.radius * 0.5);
        nameText.y = -player.radius - 15;
        nameText.style.fontSize = Math.max(12, player.radius * 0.45);
        
        // Dynamic Sword Update
        this.updateSwords(bodyGroup, player);
    }

    private updateSwords(bodyGroup: PIXI.Container, player: Player) {
        let swordContainer = bodyGroup.getChildByLabel("swords") as PIXI.Container;
        if (!swordContainer) {
            swordContainer = new PIXI.Container();
            swordContainer.label = "swords";
            bodyGroup.addChildAt(swordContainer, 0);
        }

        const knifeParts = player.knifeParts;
        const localPositions = player.knifeLocalPositions;
        const localAngles = player.knifeLocalAngles;

        // Sync sprite count with player.swordCount
        while (swordContainer.children.length < knifeParts.length) {
            if (player.knifeImg) {
                const sprite = new PIXI.Sprite(PIXI.Texture.from(player.knifeImg));
                sprite.anchor.set(0.5);
                swordContainer.addChild(sprite);
            } else break;
        }
        
        // Ensure unused sprites are hidden or removed (if swordCount decreased, though usually it only increases)
        while (swordContainer.children.length > knifeParts.length) {
            swordContainer.removeChildAt(swordContainer.children.length - 1);
        }

        for (let i = 0; i < knifeParts.length; i++) {
            const sprite = swordContainer.children[i] as PIXI.Sprite;
            // Update local positions/rotations because they might change on grow() or addSword()
            sprite.position.set(localPositions[i].x, localPositions[i].y);
            sprite.rotation = localAngles[i];
            const targetH = 65 * (player.radius / 35);
            sprite.height = targetH;
            sprite.scale.x = sprite.scale.y;
        }
    }

    private updateParticles() {
        const ents = query(world, [Position, ParticleState]);
        const count = ents.length;
        
        while (this.particlePool.length < count) {
            const s = new PIXI.Sprite(this.particleTexture!);
            s.anchor.set(0.5);
            this.particleContainer.addChild(s);
            this.particlePool.push(s);
        }

        for (let i = 0; i < this.particlePool.length; i++) {
            const s = this.particlePool[i];
            if (i < count) {
                const eid = ents[i];
                s.visible = true;
                s.position.set(Position.x[eid], Position.y[eid]);
                const life = ParticleState.life[eid];
                s.alpha = Math.max(0, life / ParticleState.maxLife[eid]);
                const colorHex = PARTICLE_COLORS[ParticleState.colorId[eid]] || '#ffffff';
                s.tint = parseInt(colorHex.replace('#', '0x'));
            } else {
                s.visible = false;
            }
        }
    }

    public drawArena(x: number, y: number, w: number, h: number) {
        this.arenaGraphic.clear();
        this.arenaGraphic.rect(x, y, w, h).stroke({ width: 4, color: 0x00ff41 });
    }

    clear() {}
    drawObstacle() {}
}
