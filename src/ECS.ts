import { createWorld, addEntity, addComponent } from 'bitecs';

// ── ECS WORLD ──
export const world = createWorld();

// ── COMPONENTS (0.4.0 style: plain objects with arrays) ──
// Note: We use Float32Array for better performance
export const Position = {
  x: new Float32Array(5000), // pre-allocate for 5000 entities
  y: new Float32Array(5000),
};

export const Velocity = {
  x: new Float32Array(5000),
  y: new Float32Array(5000),
};

export const ParticleState = {
  life: new Float32Array(5000),
  maxLife: new Float32Array(5000),
  colorId: new Uint8Array(5000),
  scale: new Float32Array(5000),
  rotation: new Float32Array(5000),
  vr: new Float32Array(5000), // rotation velocity
  typeId: new Uint8Array(5000), // 0: circle, 1: star/spark, 2: ring
};

export const PlayerComponent = {
  hp: new Float32Array(1000),
  radius: new Float32Array(1000),
  isHit: new Uint8Array(1000), // 0 or 1
  hitFlashTimer: new Float32Array(1000),
  healFlashTimer: new Float32Array(1000),
  swordCount: new Uint8Array(1000),
};

// Color mapping for fast rendering without strings
export const PARTICLE_COLORS = [
  '#FF1744', // Red (Blood)
  '#00E5FF', // Cyan
  '#FF00FF', // Pink
  '#00FF41', // Green
  '#FFD600', // Gold
];

export function createParticle(
  x: number, 
  y: number, 
  colorIndex: number = 0, 
  type: number = 0,
  scale: number = 1.0,
  speedMult: number = 1.0
) {
  const eid = addEntity(world);
  
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;

  addComponent(world, eid, Velocity);
  const angle = Math.random() * Math.PI * 2;
  const speed = (Math.random() * 8 + 2) * speedMult;
  Velocity.x[eid] = Math.cos(angle) * speed;
  Velocity.y[eid] = Math.sin(angle) * speed;

  addComponent(world, eid, ParticleState);
  ParticleState.life[eid] = 1.0;
  ParticleState.maxLife[eid] = 1.0;
  ParticleState.colorId[eid] = colorIndex;
  ParticleState.typeId[eid] = type;
  ParticleState.scale[eid] = scale;
  ParticleState.rotation[eid] = Math.random() * Math.PI * 2;
  ParticleState.vr[eid] = (Math.random() - 0.5) * 0.2;

  return eid;
}
