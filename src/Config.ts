export const GAME_CONFIG = {
    // ── CORE GAMEPLAY ──
    MAX_PLAYERS: 25,
    RESPAWN_COOLDOWN: 1000,
    VICTORY_TIMER: 20000, // 20 detik countdown kemenangan
    RESTART_DELAY: 10000, // 10 detik delay restart setelah game over
    PLAYER_RADIUS: 35,
    INITIAL_HP: 5,
    HEAL_PER_THREE_HITS: 1,
    GIFT_HP_BONUS: 5,

    // ── PHYSICS ──
    GRAVITY: 0.08,              // Sedikit lebih berat agar lebih terkontrol
    POSITION_ITERATIONS: 6,
    VELOCITY_ITERATIONS: 6,
    PHYSICS_STEP: 1000 / 60,
    KNOCKBACK_FORCE: 0.04,     // Sedikit dikurangi dari 0.05
    WALL_THICKNESS: 200,

    // ── PLAYER PHYSICS ──
    PLAYER_RESTITUTION: 0.75,
    PLAYER_FRICTION: 0.08,       // Sedikit dinaikkan untuk kontrol
    PLAYER_FRICTION_AIR: 0.01,
    PLAYER_FRICTION_STATIC: 0.01,
    PLAYER_DENSITY: 0.008,       // Sedikit lebih berat dari sebelumnya
    PLAYER_INITIAL_IMPULSE_X: 0.15,
    PLAYER_INITIAL_IMPULSE_Y: -0.25,
    PLAYER_PULL_FORCE: 0.008,    // Was 0.015 → 0.008: ngejar tapi tidak terlalu liar

    // ── SWORDS ──
    MAX_SWORDS: 4,          // Dibatasi maksimal 4 sisi saja sesuai permintaan user
    KNIFE_WIDTH: 10,         // Was 18 → 10: hitbox lebih ramping agar pas dengan visual pedang
    KNIFE_HEIGHT: 60,        // Was 65 → 60: sedikit lebih pendek agar tidak "phantom hit" di ujung
    KNIFE_OFFSET: 28,

    // ── AI & LOGIC ──
    AI_DECISION_INTERVAL: 500,
    AI_IMPULSE_FORCE_MIN: 0.008,  // Dikurangi dari 0.015
    AI_IMPULSE_FORCE_VAR: 0.008,
    AI_BEHAVIOR_INTERVAL: 1200,   // Lebih tenang dibanding 800ms
    CHAT_BOOST_FORCE: 0.06,
    LIKE_BOOST_MULTIPLIER: 1.25,

    MIN_SPEED: 3,            // Dari 5 → 3
    MAX_SPEED: 18,           // Dari 25 → 18
    MAX_ANGULAR_VELOCITY: 0.6,  // Dari 0.8 → 0.6

    // ── VISUALS ──
    BG_COLOR: 0x00050a,
    ARENA_COLOR: 0x00ff41,
    ARENA_STROKE: 4,
    SHAKE_INTENSITY: 0,
    MAX_TRAIL_LENGTH: 8,
    SWORD_TRAIL_LENGTH: 6,
    ARENA_GRID_SIZE: 120,
    HIT_COOLDOWN: 200,      // Was 600 → 200: agar pedang yang banyak bisa hit bertubi-tubi
    HIT_FLASH_DURATION: 150, // Disesuaikan dengan cooldown
    HEAL_FLASH_DURATION: 300,
    PARTICLE_SIZE: 4,
    PARTICLE_GRAVITY: 0.2,
    PARTICLE_DECAY: 0.025,  // Faster decay → fewer live particles at a time
    GLOW_STROKE: 2,
    NAME_LABEL_OFFSET: 15,
    SORT_INTERVAL: 5,       // Sort every 5 frames (was 3, imperceptible)

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
