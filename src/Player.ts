import Matter from 'matter-js';
import { GAME_CONFIG } from './Config';

const { Bodies, World, Body } = Matter;

const CIRCLE_OPTIONS = {
  restitution: 1.0,
  friction: 0.1,
  frictionAir: 0.005,
  frictionStatic: 0.1,
  density: 0.004,
  label: 'player',
};

export class Player {
  world: Matter.World;
  id: string;
  radius: number;
  hp: number = 10;
  isDead: boolean = false;
  hitCooldown: number = 0;
  isHit: boolean = false;
  hitTimer: number = 0;
  avatarImg: HTMLImageElement | null;
  knifeImg: HTMLImageElement | null;
  tiktokProfileImg: HTMLImageElement | null = null;
  knifeOffsetDistance: number;
  knifeLocalAngle: number;
  body: Matter.Body;
  behaviorTimer: number = 0;
  trail: { x: number, y: number }[] = [];
  maxTrailLength: number = GAME_CONFIG.MAX_TRAIL_LENGTH;

  constructor(
    world: Matter.World,
    x: number,
    y: number,
    radius: number,
    playerId: string,
    avatarImg: HTMLImageElement | null,
    knifeImg: HTMLImageElement | null
  ) {
    this.world = world;
    this.id = playerId;
    this.radius = radius;
    this.avatarImg = avatarImg;
    this.knifeImg = knifeImg;

    this.knifeOffsetDistance = radius + 28;
    this.knifeLocalAngle = Math.PI / 2;

    const playerIndex = Math.floor(Math.random() * 10); // Random bit for collision if not sequential
    const category = 0x1 << (playerIndex + 1);

    const circlePart = Bodies.circle(x, y, radius, {
      ...CIRCLE_OPTIONS,
      label: 'player-body'
    });
    (circlePart as any).playerId = playerId;

    const knifeWidth = 12;
    const knifeHeight = 55;
    const knifePart = Bodies.rectangle(
      x, 
      y + radius + knifeHeight / 2, 
      knifeWidth, 
      knifeHeight, 
      {
        ...CIRCLE_OPTIONS,
        label: 'player-knife'
      }
    );
    (knifePart as any).playerId = playerId;

    this.body = Body.create({
      parts: [circlePart, knifePart],
      collisionFilter: {
        category: category,
        mask: 0xFFFFFFFF ^ category,
      }
    });

    World.add(world, this.body);
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
      x: direction * 0.08,
      y: -0.15
    });
  }

  takeDamage() {
    if (this.hitCooldown > 0) return false;

    this.hp -= 1;
    this.hitCooldown = GAME_CONFIG.HIT_COOLDOWN;
    this.isHit = true;
    this.hitTimer = GAME_CONFIG.HIT_FLASH_DURATION;

    if (this.hp <= 0) {
      this.hp = 0;
      this.isDead = true;
    }

    return true;
  }

  update(delta: number, opponentBody?: Matter.Body) {
    if (this.hitCooldown > 0) this.hitCooldown -= delta;
    if (this.hitTimer > 0) {
      this.hitTimer -= delta;
      if (this.hitTimer <= 0) this.isHit = false;
    }

    this.behaviorTimer += delta;
    if (this.behaviorTimer > GAME_CONFIG.AI_BEHAVIOR_INTERVAL + Math.random() * GAME_CONFIG.AI_BEHAVIOR_INTERVAL) {
      this.behaviorTimer = 0;
      const force = GAME_CONFIG.AI_IMPULSE_FORCE_MIN + Math.random() * GAME_CONFIG.AI_IMPULSE_FORCE_VAR;
      const angle = Math.random() * Math.PI * 2;
      Body.applyForce(this.body, this.body.position, {
        x: Math.cos(angle) * force,
        y: Math.sin(angle) * force
      });
    }

    if (opponentBody) {
      const dx = opponentBody.position.x - this.body.position.x;
      const dy = opponentBody.position.y - this.body.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const pull = 0.0015;
      Body.applyForce(this.body, this.body.position, {
        x: (dx / dist) * pull,
        y: (dy / dist) * pull
      });
    }

    const maxAngularVel = GAME_CONFIG.MAX_ANGULAR_VELOCITY; 
    if (Math.abs(this.body.angularVelocity) > maxAngularVel) {
      Body.setAngularVelocity(
        this.body,
        Math.sign(this.body.angularVelocity) * maxAngularVel
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

    const knifePart = this.body.parts[2];
    const kx = knifePart.position.x;
    const ky = knifePart.position.y;
    const ka = this.body.angle;
    const tipX = kx + Math.cos(ka + Math.PI / 2) * 25;
    const tipY = ky + Math.sin(ka + Math.PI / 2) * 25;
    
    this.trail.push({ x: tipX, y: tipY });
    if (this.trail.length > this.maxTrailLength) {
      this.trail.shift();
    }
  }

  destroy() {
    World.remove(this.world, this.body);
  }
}
