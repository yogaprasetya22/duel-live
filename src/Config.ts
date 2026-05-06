export const GAME_CONFIG = {
    // ── CORE GAMEPLAY ──
    MAX_PLAYERS: 5,
    RESPAWN_COOLDOWN: 1000,
    VICTORY_TIMER: 20000, // 20 detik countdown kemenangan
    RESTART_DELAY: 10000, // 10 detik delay restart setelah game over
    PLAYER_RADIUS: 35,
    INITIAL_HP: 5,
    HEAL_PER_THREE_HITS: 1,
    GIFT_HP_BONUS: 5,

    // ── PHYSICS ──
    GRAVITY: 0.1, // Lower gravity for a "floaty" feel
    POSITION_ITERATIONS: 1,
    VELOCITY_ITERATIONS: 1,
    PHYSICS_STEP: 1000 / 60,
    KNOCKBACK_FORCE: 0.03,
    WALL_THICKNESS: 200,

    // ── PLAYER PHYSICS ──
    PLAYER_RESTITUTION: 0.8, // Slightly reduced to prevent infinite bouncing
    PLAYER_FRICTION: 0.1,   // Increased friction to allow "catching" and spinning on collision
    PLAYER_FRICTION_AIR: 0.01, // Even lower air resistance for more "free" movement
    PLAYER_FRICTION_STATIC: 0.01,
    PLAYER_DENSITY: 0.01,
    PLAYER_INITIAL_IMPULSE_X: 0.08,
    PLAYER_INITIAL_IMPULSE_Y: -0.15,
    PLAYER_PULL_FORCE: 0.005, // Increased significantly to make units hunt each other

    // ── SWORDS ──
    MAX_SWORDS: 20,
    KNIFE_WIDTH: 12,
    KNIFE_HEIGHT: 65,
    KNIFE_OFFSET: 28,

    // ── AI & LOGIC ──
    AI_DECISION_INTERVAL: 500,
    AI_IMPULSE_FORCE_MIN: 0.005, // Reduced random wandering
    AI_IMPULSE_FORCE_VAR: 0.005,
    AI_BEHAVIOR_INTERVAL: 2000, // More frequent decision making
    CHAT_BOOST_FORCE: 0.05,
    LIKE_BOOST_MULTIPLIER: 1.2,

    MIN_SPEED: 2,
    MAX_SPEED: 15,
    MAX_ANGULAR_VELOCITY: 0.4, // Increased significantly for more dynamic spinning

    // ── VISUALS ──
    BG_COLOR: 0x00050a,
    ARENA_COLOR: 0x00ff41,
    ARENA_STROKE: 4,
    SHAKE_INTENSITY: 0,
    MAX_TRAIL_LENGTH: 8,
    SWORD_TRAIL_LENGTH: 6,
    ARENA_GRID_SIZE: 120,
    HIT_COOLDOWN: 600,
    HIT_FLASH_DURATION: 300,
    HEAL_FLASH_DURATION: 300,
    PARTICLE_SIZE: 4,
    PARTICLE_GRAVITY: 0.2,
    PARTICLE_DECAY: 0.02,
    GLOW_STROKE: 2,
    NAME_LABEL_OFFSET: 15,
    SORT_INTERVAL: 3,

    // ── HUD & FONTS ──
    FONT_FAMILY: "Orbitron",
    FONT_SIZE_HUD: 14,
    FONT_SIZE_NAME: 12,
    FONT_SIZE_FPS: 16,
    FONT_STROKE_WIDTH: 6,
    ARENA_MARGIN: 5,
    HUD_ROW_HEIGHT: 60,
    HUD_ITEMS_PER_ROW: 10,
    HUD_ICON_SIZE: 40,

    // ── ARENA OBJECTS ──
    WEDGE_WIDTH: 8,
    WEDGE_HEIGHT: 35,

    // ── ASSETS ──
    BGM_PLAYLIST: [
        "/music.mp3",
        "/music1.mp3",
        "/music2.mp3",
        "/music3.mp3",
    ],
    BGM_VOLUME: 0.6,
    PLAYER_COLORS: ["#00E5FF", "#FF1744", "#00E676", "#D1C4E9", "#FFD600"],
};
