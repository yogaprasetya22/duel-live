import { createWorld, addEntity, addComponent } from 'bitecs';

// ── ECS WORLD ──
export const world = createWorld();

// ── COMPONENTS (0.4.0 style: plain objects with arrays) ──
// Note: Increased capacity to 20,000 for high-density particle effects
const MAX_ENTITIES = 20000;

export const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};

export const Velocity = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};

export const ParticleState = {
  life: new Float32Array(MAX_ENTITIES),
  maxLife: new Float32Array(MAX_ENTITIES),
  colorId: new Uint8Array(MAX_ENTITIES),
};

export const PlayerComponent = {
  hp: new Float32Array(MAX_ENTITIES),
  radius: new Float32Array(MAX_ENTITIES),
  isHit: new Uint8Array(MAX_ENTITIES), 
  hitFlashTimer: new Float32Array(MAX_ENTITIES),
  healFlashTimer: new Float32Array(MAX_ENTITIES),
  swordCount: new Uint8Array(MAX_ENTITIES),
};

// Color mapping for fast rendering without strings
export const PARTICLE_COLORS = [
  '#FF1744', // Red (Blood)
  '#00E5FF', // Cyan
  '#FF00FF', // Pink
  '#00FF41', // Green
  '#FFD600', // Gold
];

export function createParticle(x: number, y: number, colorIndex: number = 0) {
  const eid = addEntity(world);
  
  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;

  addComponent(world, eid, Velocity);
  const angle = Math.random() * Math.PI * 2;
  const speed = Math.random() * 8 + 2;
  Velocity.x[eid] = Math.cos(angle) * speed;
  Velocity.y[eid] = Math.sin(angle) * speed;

  addComponent(world, eid, ParticleState);
  ParticleState.life[eid] = 1.0;
  ParticleState.maxLife[eid] = 1.0;
  ParticleState.colorId[eid] = colorIndex;

  return eid;
}
