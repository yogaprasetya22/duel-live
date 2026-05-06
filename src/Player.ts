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
    trail: { x: number; y: number }[] = [];
    swordTrails: { x: number; y: number }[][] = [];
    maxTrailLength: number = GAME_CONFIG.MAX_TRAIL_LENGTH;
    swordCount: number = 1;
    category: number;
    knifeParts: Matter.Body[] = [];
    knifeLocalPositions: { x: number; y: number }[] = [];
    knifeLocalAngles: number[] = [];

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
    }

    createBody(x: number, y: number) {
        // Always reset these before populating — recreateBody calls createBody again
        this.knifeParts = [];
        this.knifeLocalPositions = [];
        this.knifeLocalAngles = [];

        const circlePart = Bodies.circle(x, y, this.radius, {
            ...CIRCLE_OPTIONS,
            label: "player-body",
        });
        (circlePart as any).playerId = this.id;

        // Scale knife based on current radius (baseline radius is 35)
        const scaleFactor = this.radius / GAME_CONFIG.PLAYER_RADIUS;
        const knifeWidth = GAME_CONFIG.KNIFE_WIDTH * scaleFactor;
        const knifeHeight = GAME_CONFIG.KNIFE_HEIGHT * scaleFactor;
        const parts = [circlePart];

        for (let i = 0; i < this.swordCount; i++) {
            // Calculate angle for each sword (evenly spaced)
            const angle = Math.PI / 2 + i * ((Math.PI * 2) / this.swordCount);
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
                    angle: angle - Math.PI / 2, // Rotate to face outward
                },
            );
            (knifePart as any).playerId = this.id;
            parts.push(knifePart);
            this.knifeParts.push(knifePart);
            this.knifeLocalPositions.push({ x: kx - x, y: ky - y });
            this.knifeLocalAngles.push(angle + Math.PI / 2);
        }

        const body = Body.create({
            parts: parts,
            frictionAir: GAME_CONFIG.PLAYER_FRICTION_AIR,
            restitution: GAME_CONFIG.PLAYER_RESTITUTION,
        });

        // Reduce inertia to make it spin more easily on impact
        Body.setInertia(body, body.inertia * 0.5);

        return body;
    }

    addSword() {
        if (this.swordCount >= GAME_CONFIG.MAX_SWORDS) return;
        this.swordCount++;
        this.recreateBody();
    }

    grow(factor: number) {
        this.radius *= factor;
        this.knifeOffsetDistance *= factor;
        this.recreateBody();
    }

    recreateBody() {
        const oldPos = { ...this.body.position };
        const oldVel = { ...this.body.velocity };
        const oldAngle = this.body.angle;
        const oldAngVel = this.body.angularVelocity;

        World.remove(this.world, this.body);
        this.body = this.createBody(oldPos.x, oldPos.y); // createBody resets knifeParts internally
        Body.setVelocity(this.body, oldVel);
        Body.setAngle(this.body, oldAngle);
        Body.setAngularVelocity(this.body, oldAngVel);
        World.add(this.world, this.body);

        // Notify game to remap body→player (called externally via onBodyRecreated)
        if (typeof (this as any)._onBodyRecreated === "function") {
            (this as any)._onBodyRecreated(this);
        }
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
        if (this.hitsDealt >= 2) {
            this.heal(GAME_CONFIG.HEAL_PER_TWO_HITS);
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

        // ── Update Sword Trails (Wind Effect) ──
        // Use this.knifeParts directly — already maintained, no filter() needed
        const knifeParts = this.knifeParts;
        const knifeCount = knifeParts.length;

        if (this.swordTrails.length !== knifeCount) {
            this.swordTrails = Array.from({ length: knifeCount }, () => []);
        }

        const cx = this.body.position.x;
        const cy = this.body.position.y;

        for (let i = 0; i < knifeCount; i++) {
            const kPart = knifeParts[i];
            const verts = kPart.vertices;
            const vLen = verts.length;

            // Find two furthest vertices without sort() — O(n) single pass
            let best1 = 0,
                best2 = 1;
            let dist1 = 0,
                dist2 = 0;
            for (let v = 0; v < vLen; v++) {
                const dx = verts[v].x - cx;
                const dy = verts[v].y - cy;
                const d = dx * dx + dy * dy;
                if (d > dist1) {
                    dist2 = dist1;
                    best2 = best1;
                    dist1 = d;
                    best1 = v;
                } else if (d > dist2) {
                    dist2 = d;
                    best2 = v;
                }
            }

            const tipX = (verts[best1].x + verts[best2].x) * 0.5;
            const tipY = (verts[best1].y + verts[best2].y) * 0.5;

            const trail = this.swordTrails[i];
            trail.push({ x: tipX, y: tipY });
            if (trail.length > GAME_CONFIG.SWORD_TRAIL_LENGTH) {
                trail.shift();
            }
        }
    }

    destroy() {
        World.remove(this.world, this.body);
    }
}
