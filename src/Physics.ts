import Matter from 'matter-js';
import { GAME_CONFIG } from './Config';

const { Engine } = Matter;

export function createPhysicsWorld() {
  const engine = Engine.create({
    gravity: { x: 0, y: GAME_CONFIG.GRAVITY },
    positionIterations: GAME_CONFIG.POSITION_ITERATIONS,
    velocityIterations: GAME_CONFIG.VELOCITY_ITERATIONS,
  });

  return { engine, world: engine.world };
}
