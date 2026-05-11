export const GAME_CONFIG = {
    // ── CORE GAMEPLAY ──
    MAX_PLAYERS: 10,
    VIP_MAX_PLAYERS: 25, // Givers can join up to this limit immediately
    RESPAWN_COOLDOWN: 1000,
    VICTORY_TIMER: 600000, // 10 menit battle duration
    RESTART_DELAY: 10000, // 10 detik delay restart setelah game over
    PLAYER_RADIUS: 25,
    MAX_PLAYER_RADIUS: 65, // Cap ukuran agar tidak memenuhi layar (User requested 65)
    INITIAL_HP: 10,
    MAX_PLAYER_HP: 99999999, // Effectively unlimited HP as requested
    HEAL_PER_THREE_HITS: 1,
    GIFT_HP_BONUS: 5,
    SPAWN_MARGIN: 100, // Jarak aman agar tidak spawn nempel dinding

    // ── PHYSICS ──
    GRAVITY: 0.08, 
    POSITION_ITERATIONS: 2, // 4 -> 2 for maximum CPU performance during high density
    VELOCITY_ITERATIONS: 2, // 4 -> 2 for maximum CPU performance
    PHYSICS_STEP: 1000 / 60,
    KNOCKBACK_FORCE: 0.08, // Increased for better displacement feel
    WALL_THICKNESS: 200,

    // ── PLAYER PHYSICS ──
    PLAYER_RESTITUTION: 0.75,
    PLAYER_FRICTION: 0.08, // Sedikit dinaikkan untuk kontrol
    PLAYER_FRICTION_AIR: 0.01,
    PLAYER_FRICTION_STATIC: 0.01,
    PLAYER_DENSITY: 0.008, // Sedikit lebih berat dari sebelumnya
    PLAYER_INITIAL_IMPULSE_X: 0.15,
    PLAYER_INITIAL_IMPULSE_Y: -0.25,
    PLAYER_PULL_FORCE: 0.008, // Was 0.015 → 0.008: ngejar tapi tidak terlalu liar

    // ── SWORDS ──
    MAX_SWORDS: 4, // Dibatasi maksimal 4 sisi saja sesuai permintaan user
    KNIFE_WIDTH: 10, // Was 18 → 10: hitbox lebih ramping agar pas dengan visual pedang
    KNIFE_HEIGHT: 60, // Was 65 → 60: sedikit lebih pendek agar tidak "phantom hit" di ujung
    KNIFE_OFFSET: 28,

    // ── AI & LOGIC ──
    AI_DECISION_INTERVAL: 500,
    AI_IMPULSE_FORCE_MIN: 0.008, // Dikurangi dari 0.015
    AI_IMPULSE_FORCE_VAR: 0.008,
    AI_BEHAVIOR_INTERVAL: 1200, // Lebih tenang dibanding 800ms
    CHAT_BOOST_FORCE: 0.06,
    LIKE_BOOST_MULTIPLIER: 1.25,

    MIN_SPEED: 3, // Dari 5 → 3
    MAX_SPEED: 18, // Dari 25 → 18
    MAX_ANGULAR_VELOCITY: 0.6, // Dari 0.8 → 0.6

    // ── VISUALS ──
    BG_COLOR: 0x00050a,
    ARENA_COLOR: 0x00ff41,
    ARENA_STROKE: 4, // Dikembalikan ke awal sesuai permintaan
    SHAKE_INTENSITY: 0,
    MAX_TRAIL_LENGTH: 4, // 8 -> 4: Less geometry generated per frame
    SWORD_TRAIL_LENGTH: 3, // 6 -> 3: Drastically reduces fill rate overhead
    ARENA_GRID_SIZE: 60,
    GRID_ALPHA: 0.15,
    GRID_SPEED: 0.2,
    AMBIENT_PARTICLE_COUNT: 0, // 20 -> 0: Removed to save GPU draw calls
    HIT_COOLDOWN: 200,
    HIT_FLASH_DURATION: 150,
    HEAL_FLASH_DURATION: 300,
    PARTICLE_SIZE: 4,
    PARTICLE_GRAVITY: 0.2,
    PARTICLE_DECAY: 0.08, // 0.04 -> 0.08: Particles disappear twice as fast
    FLASH_DECAY: 0.2, // 0.1 -> 0.2: Flashes resolve faster
    SHOCKWAVE_GROWTH: 15,
    SHOCKWAVE_DECAY: 0.05,
    GLOW_STROKE: window.innerWidth < 600 ? 4 : 8, // Thinner glow on mobile for performance
    NAME_LABEL_OFFSET: 15,
    SORT_INTERVAL: 10, // Sort every 10 frames (Was 5: saves CPU)

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
    BGM_PLAYLIST: ["/music.mp3", "/music1.mp3", "/music2.mp3", "/music3.mp3"],
    BGM_VOLUME: 0.6,
    PLAYER_COLORS: ["#00E5FF", "#FF1744", "#00E676", "#D1C4E9", "#FFD600"],

    // ── PRESTIGE & SKILLS ──
    PRESTIGE_HP_ELITE: 100,
    PRESTIGE_HP_EPIC: 300,
    PRESTIGE_HP_LEGENDARY: 500,

    SWORD_HP_TIER_2: 30,
    SWORD_HP_TIER_3: 100,
    SWORD_HP_TIER_4: 400,

    SKILL_SHOCKWAVE_COOLDOWN: 3000, // ms
    SKILL_SHOCKWAVE_RADIUS: 400,
    SKILL_SHOCKWAVE_FORCE: 0.05,

    SKILL_LIGHTNING_COOLDOWN: 4500, // ms
    SKILL_LIGHTNING_RADIUS: 400,
    SKILL_LIGHTNING_DAMAGE: 5,
    SKILL_LIGHTNING_MAX_TARGETS: 5,
};
