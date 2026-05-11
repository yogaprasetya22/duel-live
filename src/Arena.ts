import Matter from 'matter-js';
import { GAME_CONFIG } from './Config';

const { Bodies, World } = Matter;

const WALL_OPTIONS = {
  isStatic: true,
  restitution: GAME_CONFIG.PLAYER_RESTITUTION,
  friction: 0,
  frictionStatic: 0,
  label: 'wall'
};

export function createArena(world: Matter.World, arenaX: number, arenaY: number, arenaW: number, arenaH: number) {
  const thickness = GAME_CONFIG.WALL_THICKNESS;
  const cx = arenaX + arenaW / 2;
  const cy = arenaY + arenaH / 2;

  const walls = [
    // lantai (bottom)
    Bodies.rectangle(cx, arenaY + arenaH + thickness / 2, arenaW + thickness * 2, thickness, WALL_OPTIONS),
    // langit-langit (top)
    Bodies.rectangle(cx, arenaY - thickness / 2, arenaW + thickness * 2, thickness, WALL_OPTIONS),
    // kiri (left)
    Bodies.rectangle(arenaX - thickness / 2, cy, thickness, arenaH, WALL_OPTIONS),
    // kanan (right)
    Bodies.rectangle(arenaX + arenaW + thickness / 2, cy, thickness, arenaH, WALL_OPTIONS),
  ];

  World.add(world, [...walls]);
  return { walls, obstacles: [] };
}
