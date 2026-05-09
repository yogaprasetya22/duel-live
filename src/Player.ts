import Matter from "matter-js";
import { GAME_CONFIG } from "./Config";

const { Bodies, World, Body } = Matter;

const CIRCLE_OPTIONS = {
    restitution: GAME_CONFIG.PLAYER_RESTITUTION,
    friction: GAME_CONFIG.PLAYER_FRICTION,
    frictionAir: GAME_CONFIG.PLAYER_FRICTION_AIR,
    frictionStatic: GAME_CONFIG.PLAYER_FRICTION_STATIC,
    density: GAME_CONFIG.PLAYER_DENSITY,
    label: "player",
};

export class Player {
    world: Matter.World;
    id: string;
    radius: number;
    hp: number = GAME_CONFIG.INITIAL_HP;
    isDead: boolean = false;
    hitCooldown: number = 0;
    isHit: boolean = false;
    hitFlashTimer: number = 0;
    healFlashTimer: number = 0;
    hitsDealt: number = 0;
    avatarImg: HTMLImageElement | null;
    knifeImg: HTMLImageElement | null;
    tiktokProfileImg: HTMLImageElement | null = null;
    knifeOffsetDistance: number;
    knifeLocalAngle: number;
    body: Matter.Body;
    behaviorTimer: number = 0;
    trail: Float32Array; 
    swordTrails: Float32Array[] = [];
    swordTrailIndices: Uint32Array = new Uint32Array(0);
    maxTrailLength: number = GAME_CONFIG.MAX_TRAIL_LENGTH;
    swordCount: number = 1;
    category: number;
    knifeParts: Matter.Body[] = [];
    knifeLocalPositions: { x: number; y: number }[] = [];
    knifeLocalAngles: number[] = [];
    activeSwordSlots: boolean[] = []; // Which of the 8 slots are currently active

    // Symmetrical patterns for up to 8 swords
    private readonly SWORD_PATTERNS = [
        [], // 0
        [0], // 1
        [0, 4], // 2 (Top, Bottom)
        [0, 3, 5], // 3 (Top, Bottom-Right, Bottom-Left)
        [0, 2, 4, 6], // 4 (Cross)
        [0, 2, 3, 5, 6], // 5
        [0, 1, 2, 4, 5, 6], // 6
        [0, 1, 2, 3, 4, 5, 6], // 7
        [0, 1, 2, 3, 4, 5, 6, 7] // 8
    ];

    constructor(
        world: Matter.World,
        x: number,
        y: number,
        radius: number,
        playerId: string,
        avatarImg: HTMLImageElement | null,
        knifeImg: HTMLImageElement | null,
    ) {
        this.world = world;
        this.id = playerId;
        this.radius = radius;
        this.avatarImg = avatarImg;
        this.knifeImg = knifeImg;

        this.knifeOffsetDistance = radius + GAME_CONFIG.KNIFE_OFFSET;
        this.knifeLocalAngle = Math.PI / 2;

        const playerIndex = Math.floor(Math.random() * 10);
        this.category = 0x1 << (playerIndex + 1);

        this.body = this.createBody(x, y);
        World.add(world, this.body);

        // Pre-allocate trails as Float32Arrays [x0, y0, x1, y1, ...]
        this.trail = new Float32Array(this.maxTrailLength * 2);
    }

    createBody(x: number, y: number) {
        this.knifeParts = [];
        this.knifeLocalPositions = [];
        this.knifeLocalAngles = [];

        const circlePart = Bodies.circle(x, y, this.radius, {
            ...CIRCLE_OPTIONS,
            label: "player-body",
        });
        (circlePart as any).playerId = this.id;

        const parts = [circlePart];
        const maxSwords = GAME_CONFIG.MAX_SWORDS;

        // Baseline scale factor
        const scaleFactor = this.radius / GAME_CONFIG.PLAYER_RADIUS;
        const knifeWidth = GAME_CONFIG.KNIFE_WIDTH * scaleFactor;
        const knifeHeight = GAME_CONFIG.KNIFE_HEIGHT * scaleFactor;

        for (let i = 0; i < maxSwords; i++) {
            const angle = Math.PI / 2 + i * ((Math.PI * 2) / maxSwords);
            const dist = this.radius + knifeHeight / 2;

            const kx = x + Math.cos(angle) * dist;
            const ky = y + Math.sin(angle) * dist;

            const knifePart = Bodies.rectangle(
                kx,
                ky,
                knifeWidth,
                knifeHeight,
                {
                    ...CIRCLE_OPTIONS,
                    label: "player-knife",
                    angle: angle - Math.PI / 2,
                    isSensor: true, // Will be set correctly in repositionSwords()
                    collisionFilter: { mask: 0 } // Base mask
                },
            );
            (knifePart as any).playerId = this.id;
            parts.push(knifePart);
            this.knifeParts.push(knifePart);
            this.knifeLocalPositions.push({ x: kx - x, y: ky - y });
            this.knifeLocalAngles.push(angle + Math.PI / 2);
            this.activeSwordSlots.push(false);
        }

        const body = Body.create({
            parts: parts,
            frictionAir: GAME_CONFIG.PLAYER_FRICTION_AIR,
            restitution: GAME_CONFIG.PLAYER_RESTITUTION,
        });

        Body.setInertia(body, body.inertia * 0.5);
        this.repositionSwords(); // Initialize active slots
        return body;
    }

    addSword() {
        if (this.swordCount >= GAME_CONFIG.MAX_SWORDS) return;
        this.swordCount++;
        this.repositionSwords();
    }

    repositionSwords() {
        const pattern = this.SWORD_PATTERNS[Math.min(this.swordCount, GAME_CONFIG.MAX_SWORDS)] || this.SWORD_PATTERNS[8];
        
        for (let i = 0; i < GAME_CONFIG.MAX_SWORDS; i++) {
            const kp = this.knifeParts[i];
            const isActive = pattern.includes(i);
            
            this.activeSwordSlots[i] = isActive;
            kp.isSensor = !isActive;
            // NOTE: collisionFilter on parts is overridden by parent, so isSensor is the source of truth
        }
    }
    grow(factor: number) {
        this.radius *= factor;
        this.knifeOffsetDistance *= factor;
        
        // Use efficient physics scaling
        Body.scale(this.body, factor, factor);
        
        // Notify game/renderer if needed (Renderer already checks radius change every frame)
    }

    // Reset player for pooling
    reset(x: number, y: number, name: string, avatar: HTMLImageElement | null) {
        this.id = name;
        this.avatarImg = avatar;
        this.hp = GAME_CONFIG.INITIAL_HP;
        this.isDead = false;
        this.swordCount = 1;
        this.hitsDealt = 0;
        
        // Reset physics
        Body.setPosition(this.body, { x, y });
        Body.setVelocity(this.body, { x: 0, y: 0 });
        Body.setAngle(this.body, 0);
        Body.setAngularVelocity(this.body, 0);
        
        this.repositionSwords();
    }

    getKnifeWorldTransform() {
        const angle = this.body.angle + this.knifeLocalAngle;
        const cx = this.body.position.x;
        const cy = this.body.position.y;

        return {
            x: cx + Math.cos(angle) * this.knifeOffsetDistance,
            y: cy + Math.sin(angle) * this.knifeOffsetDistance,
            rotation: angle,
        };
    }

    applyInitialImpulse() {
        const direction = Math.random() > 0.5 ? 1 : -1;
        Body.applyForce(this.body, this.body.position, {
            x: direction * GAME_CONFIG.PLAYER_INITIAL_IMPULSE_X,
            y: GAME_CONFIG.PLAYER_INITIAL_IMPULSE_Y,
        });
    }

    takeDamage() {
        if (this.hitCooldown > 0) return false;

        this.hp -= 1;
        this.hitCooldown = GAME_CONFIG.HIT_COOLDOWN;
        this.isHit = true;
        this.hitFlashTimer = GAME_CONFIG.HIT_FLASH_DURATION;

        if (this.hp <= 0) {
            this.hp = 0;
            this.isDead = true;
        }

        return true;
    }

    heal(amount: number) {
        this.hp += amount;
        this.healFlashTimer = GAME_CONFIG.HEAL_FLASH_DURATION;
    }

    onHitDealt() {
        this.hitsDealt++;
        if (this.hitsDealt >= 3) {
            this.heal(GAME_CONFIG.HEAL_PER_THREE_HITS);
            this.hitsDealt = 0;
        }
    }

    update(delta: number, opponentBody?: Matter.Body) {
        if (this.hitCooldown > 0) this.hitCooldown -= delta;
        if (this.hitFlashTimer > 0) {
            this.hitFlashTimer -= delta;
            if (this.hitFlashTimer <= 0) this.isHit = false;
        }

        if (this.healFlashTimer > 0) {
            this.healFlashTimer -= delta;
        }

        this.behaviorTimer += delta;
        if (
            this.behaviorTimer >
            GAME_CONFIG.AI_BEHAVIOR_INTERVAL +
                Math.random() * GAME_CONFIG.AI_BEHAVIOR_INTERVAL
        ) {
            this.behaviorTimer = 0;
            const force =
                GAME_CONFIG.AI_IMPULSE_FORCE_MIN +
                Math.random() * GAME_CONFIG.AI_IMPULSE_FORCE_VAR;
            const angle = Math.random() * Math.PI * 2;
            Body.applyForce(this.body, this.body.position, {
                x: Math.cos(angle) * force,
                y: Math.sin(angle) * force,
            });
        }

        if (opponentBody) {
            const dx = opponentBody.position.x - this.body.position.x;
            const dy = opponentBody.position.y - this.body.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const pull = GAME_CONFIG.PLAYER_PULL_FORCE;
            Body.applyForce(this.body, this.body.position, {
                x: (dx / dist) * pull,
                y: (dy / dist) * pull,
            });
        }

        const maxAngularVel = GAME_CONFIG.MAX_ANGULAR_VELOCITY;
        if (Math.abs(this.body.angularVelocity) > maxAngularVel) {
            Body.setAngularVelocity(
                this.body,
                Math.sign(this.body.angularVelocity) * maxAngularVel,
            );
        }

        const vel = this.body.velocity;
        const maxSpeed = GAME_CONFIG.MAX_SPEED;
        const minSpeed = GAME_CONFIG.MIN_SPEED;
        const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2);

        if (speed > maxSpeed) {
            Body.setVelocity(this.body, {
                x: (vel.x / speed) * maxSpeed,
                y: (vel.y / speed) * maxSpeed,
            });
        } else if (speed < minSpeed) {
            const angle = Math.random() * Math.PI * 2;
            Body.setVelocity(this.body, {
                x: (vel.x / speed || Math.cos(angle)) * minSpeed,
                y: (vel.y / speed || Math.sin(angle)) * minSpeed,
            });
        }

        // ── Update Sword Trails (Circular Buffer - Zero Allocation) ──
        const knifeParts = this.knifeParts;

        if (this.swordTrails.length !== knifeParts.length) {
            // Re-allocate only when total capacity changes (rare)
            this.swordTrails = Array.from({ length: knifeParts.length }, () => new Float32Array(GAME_CONFIG.SWORD_TRAIL_LENGTH * 2));
            this.swordTrailIndices = new Uint32Array(knifeParts.length);
        }

        // ONLY update trails for active swords to save CPU
        for (let i = 0; i < GAME_CONFIG.MAX_SWORDS; i++) {
            if (!this.activeSwordSlots[i]) continue;
            
            const kPart = knifeParts[i];
            const verts = kPart.vertices;

            // Tip of the knife
            const tipX = (verts[0].x + verts[1].x) * 0.5;
            const tipY = (verts[0].y + verts[1].y) * 0.5;

            const trail = this.swordTrails[i];
            const head = this.swordTrailIndices[i];
            
            trail[head * 2] = tipX;
            trail[head * 2 + 1] = tipY;
            
            this.swordTrailIndices[i] = (head + 1) % GAME_CONFIG.SWORD_TRAIL_LENGTH;
        }
    }

    destroy() {
        World.remove(this.world, this.body);
    }
}
