// ═══════════════════════════════════════════════════════════════════════
// MAIN.JS
//
// WHAT THIS FILE IS: the only file that touches Phaser/the DOM. It draws
// whatever the engine's state says exists, and plays the sounds/animations
// the engine tells it to after each key press. It decides nothing: whether
// a key counts, what it does, which faces-bar boxes light, which sounds
// play, pause and game over are all decided by engine.wasm (via engine.js).
//
// HOW THE FILE IS ORGANIZED — search for these banners to jump around:
//   FEATURE: BOOTSTRAP & GLOBAL STATE     — Phaser config, shared variables
//   FEATURE: ASSET LOADING                — preload()
//   FEATURE: SCENE SETUP                  — create()
//   FEATURE: TILE / FACE RENDERING        — drawing the 9 tiles of a face
//   FEATURE: HUBIE SPRITE ANIMATION       — walk relay + slide transition
//   FEATURE: FACE TRACKER                 — the 6-slot "which colors are solved" display
//   FEATURE: WIN SEQUENCE                 — the "Cube Solved!" screen
//   FEATURE: PAUSE MENU                   — the Pause button + its modal
//   FEATURE: INPUT                        — keydown → engine → animation + sound
// ═══════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: BOOTSTRAP & GLOBAL STATE
// Phaser's game config, the one CubeEngine instance this whole file reads
// from and sends input to, and every persistent variable other features
// below need to share. Nothing in this block does any work by itself.
// ═══════════════════════════════════════════════════════════════════════

const config = {
    type: Phaser.AUTO,
    width: 950,
    height: 650,
    parent: 'game-pane',
    backgroundColor: '#111111',
    // Shrink/grow the 950x650 game to fit the window and center it. All game
    // coordinates stay 950x650 — Phaser only scales the canvas on screen.
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: { preload: preload, create: create }
};

// THE single source of truth for the cube, Hubie, and all game rules — the
// engine.wasm brain, reached through engine.js. This file only reads state
// from it (get_state_snapshot()), forwards raw keystrokes to it (press()),
// and reports finished animations (done()) and pause (pause()).
//
// A new random cube every game. For testing, ?seed=N in the address always
// builds the same cube.
const url_seed = parseInt(new URLSearchParams(location.search).get('seed'), 10);
let engine = null;
let game = null;

// The .wasm loads asynchronously, so the game starts once it's ready.
CubeEngine.load().then(() => {
    engine = new CubeEngine(Number.isInteger(url_seed) ? url_seed : undefined);
    game = new Phaser.Game(config);
});

// ─────────────────────────────────────────────────────────────────────
// THE CUBE'S COLOR PALETTE — the ONE place any hex value for a cube color
// lives. Every tile, Hubie's tint, and the face tracker all read colors
// through this single map (color_hex_map[colorName]) — nothing else in
// this file hardcodes a cube-color hex value. To use a different palette,
// edit the six values below; nothing else needs to change.
//
// These specific values are the old project's official-Rubik's-Cube hexes.
// ─────────────────────────────────────────────────────────────────────
const color_hex_map = {
    green:  0x009B48,
    white:  0xFFFFFF,
    yellow: 0xFFD500,
    red:    0xC41E3A,
    blue:   0x0046AD,
    orange: 0xFF5800,
};

// Layout constants for the single visible face — how big each tile is (96px,
// matching the sprite/asset size), the gap between tiles, and the 3x3 grid.
// originX/originY (the top-left corner of the 3x3 grid on screen) are
// computed once in create() from the canvas size, so the face is centered.
const TILE = 96;
const GAP = 4;
const GRID = 3;
let originX = 0, originY = 0;

// Persistent Phaser scene objects — all built ONCE in create(), never
// destroyed/recreated. Every render just updates these in place.
let scene_ref = null;          // captured scene context, since this file uses free functions, not a class
let faceContainer = null;      // the currently-visible face's 9 tile graphics
let incomingContainer = null;  // used only during a face-crossing slide transition
let tileGraphics = [];         // current 9 tile graphic refs, mirrors faceContainer's children, indexed 0-8

let hubie_idle_sprite = null;  // shown whenever Hubie isn't mid-animation
let hubie_start_sprite = null; // plays a "walking away" animation
let hubie_end_sprite = null;   // plays a "walking in" animation

let game_sound = null; // the SoundEngine instance — see SoundEngine.js

let face_tracker_slots = []; // the 6 color-indicator boxes — see FEATURE: FACE TRACKER


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: ASSET LOADING
// Loads every sprite sheet and sound file the game needs. Runs once,
// before create(), as Phaser's normal preload phase.
// ═══════════════════════════════════════════════════════════════════════

// #FIX — the old sprite sheets have DIFFERENT frame counts per direction
// (confirmed from the actual PNG dimensions: up/down sheets are 960px = 10
// frames, left/right "start" sheets are 480px = 5 frames, left/right "end"
// sheets are 672px = 7 frames). The old GameScene.js hardcoded `end: 9` (10
// frames) for every animation regardless of its sheet's real size, which
// would read past the end of the shorter left/right sheets. Fixed here by
// using each sheet's actual frame count — see create() where this is used.
const ANIM_FRAME_COUNT = {
    hubie_up_start: 10, hubie_up_end: 10,
    hubie_down_start: 10, hubie_down_end: 10,
    hubie_left_start: 5, hubie_left_end: 7,
    hubie_right_start: 5, hubie_right_end: 7,
};

function preload() {
    const load = (key, file) => {
        this.load.spritesheet(key, `assets/${file}`, { frameWidth: 96, frameHeight: 96 });
    };
    load('hubie_idle', 'hubie_idle.png');
    load('hubie_up_start', 'hubie_up_start.png');
    load('hubie_up_end', 'hubie_up_end.png');
    load('hubie_down_start', 'hubie_down_start.png');
    load('hubie_down_end', 'hubie_down_end.png');
    load('hubie_left_start', 'hubie_left_start.png');
    load('hubie_left_end', 'hubie_left_end.png');
    load('hubie_right_start', 'hubie_right_start.png');
    load('hubie_right_end', 'hubie_right_end.png');

    SoundEngine.preload(this); // registers all 10 sound-effect files
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: SCENE SETUP
// Phaser calls this once, after preload() finishes. Builds every
// persistent object every other feature below needs, does the very first
// paint of the cube/Hubie/tracker, wires up the keyboard listener, and
// gates input behind the start-of-game sound.
// ═══════════════════════════════════════════════════════════════════════

function create() {
    scene_ref = this;

    // Center the 3x3 tile grid in the canvas.
    const gridSize = GRID * TILE + (GRID - 1) * GAP;
    originX = (this.scale.width - gridSize) / 2;
    originY = (this.scale.height - gridSize) / 2;

    faceContainer = this.add.container(0, 0);
    incomingContainer = this.add.container(0, 0);
    incomingContainer.setAlpha(0); // invisible until a transition needs it

    // One 10-frame-rate animation per direction/part, using each sheet's
    // REAL frame count (see #FIX above, ANIM_FRAME_COUNT).
    ['up', 'down', 'left', 'right'].forEach(dir => {
        ['start', 'end'].forEach(part => {
            const key = `hubie_${dir}_${part}`;
            this.anims.create({
                key,
                frames: this.anims.generateFrameNumbers(key, { start: 0, end: ANIM_FRAME_COUNT[key] - 1 }),
                frameRate: 10,
                repeat: 0,
            });
        });
    });

    hubie_start_sprite = this.add.sprite(0, 0, 'hubie_up_start').setVisible(false).setDepth(6);
    hubie_end_sprite   = this.add.sprite(0, 0, 'hubie_up_end').setVisible(false).setDepth(6);
    hubie_idle_sprite  = this.add.sprite(0, 0, 'hubie_idle').setVisible(false).setDepth(6);

    game_sound = new SoundEngine(this);
    game_sound.init();

    build_face_tracker(this);
    paint_face_tracker(engine.get_state_snapshot().bar);

    build_face(faceContainer, engine.faces[engine.FRONT]);
    place_hubie_idle(engine.get_state_snapshot());

    // event.key is the raw browser keystroke — it goes to the engine
    // untouched; the engine decides whether it means anything.
    this.input.keyboard.on('keydown', (event) => {
        handle_key(event.key);
    });

    // The engine keeps input locked until the start-of-game sound finishes.
    const startSnd = this.sound.get('snd_start');
    if (startSnd) {
        startSnd.play();
        startSnd.once('complete', () => engine.done());
    } else {
        engine.done();
    }
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: TILE / FACE RENDERING
// Draws the 9 tiles of a face as flat-colored rectangles. Ported from
// GameScene.js's _buildFace/_drawTile/_tileCenter, adapted to read a plain
// 9-color array (engine.faces[0]) instead of the old numeric "grid" format.
// These functions do no animation and make no decisions — given a
// container and a set of 9 colors, they just draw them.
// ═══════════════════════════════════════════════════════════════════════

// Wipes and rebuilds a container's 9 tile graphics from a color array.
// Used for the resting face (faceContainer) and, during a transition, to
// pre-build the incoming face's look before it slides on screen.
function build_face(container, faceColors) {
    container.removeAll(true);
    const graphics = [];
    for (let i = 0; i < 9; i++) {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const g = scene_ref.add.graphics();
        draw_tile(g, color_hex_map[faceColors[i]], TILE);
        g.x = originX + col * (TILE + GAP);
        g.y = originY + row * (TILE + GAP);
        container.add(g);
        graphics.push(g);
    }
    tileGraphics = graphics;
    return graphics;
}

// Draws one flat-colored tile with a subtle bottom/right shadow edge for depth.
function draw_tile(g, hexColor, size) {
    g.clear();
    g.fillStyle(hexColor, 1);
    g.fillRect(0, 0, size, size);
    g.fillStyle(0x000000, 0.18);
    g.fillRect(0, size - 4, size, 4);
    g.fillRect(size - 4, 0, 4, size);
}

// Screen-space center point of tile (row, col) in the 3x3 grid.
function tile_center(row, col) {
    return {
        x: originX + col * (TILE + GAP) + TILE / 2,
        y: originY + row * (TILE + GAP) + TILE / 2,
    };
}

// Same as tile_center(), but takes a flat 0-8 tile index (matches
// engine.js's hubie_index numbering) instead of a separate row/col.
function tile_center_by_index(index) {
    return tile_center(Math.floor(index / 3), index % 3);
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: HUBIE SPRITE ANIMATION
// Everything about how Hubie visually moves. Ported from GameScene.js's
// _placeHubieIdle/_animateMove/_animateTransition/_executeSwap, driven by
// OUR engine's real state instead of the old CubeEngine's row/col fields.
// None of these functions decide WHETHER Hubie moves — they're only ever
// called after engine.js has already decided a move happened, to show it.
// ═══════════════════════════════════════════════════════════════════════

// Snaps Hubie's idle sprite onto his current tile with no animation — used
// for the very first paint.
function place_hubie_idle(state) {
    hubie_start_sprite.setVisible(false);
    hubie_end_sprite.setVisible(false);
    const pos = tile_center_by_index(state.hubie_index);
    hubie_idle_sprite.setPosition(pos.x, pos.y);
    hubie_idle_sprite.setTint(color_hex_map[state.hubie_cargo]);
    hubie_idle_sprite.setVisible(true);
}

// Two-sprite relay: a "start" sprite plays a walk-away animation at the
// origin tile while an "end" sprite plays a walk-in animation at the
// destination tile. The END sprite's animationcomplete marks the move as
// visually finished — same technique as the old GameScene.js. Used for
// in-face movement only (crossed_face === false in the result packet).
function animate_move(direction, prevState, newState, onDone) {
    const dir = direction.toLowerCase();
    const tint = color_hex_map[newState.hubie_cargo];

    hubie_idle_sprite.setVisible(false);
    hubie_start_sprite.setTexture(`hubie_${dir}_start`).setTint(tint);
    hubie_end_sprite.setTexture(`hubie_${dir}_end`).setTint(tint);

    const from = tile_center_by_index(prevState.hubie_index);
    const to = tile_center_by_index(newState.hubie_index);

    hubie_start_sprite.setPosition(from.x, from.y).setVisible(true);
    hubie_end_sprite.setPosition(to.x, to.y).setVisible(true);
    hubie_start_sprite.play(`hubie_${dir}_start`);
    hubie_end_sprite.play(`hubie_${dir}_end`);

    hubie_end_sprite.once('animationcomplete', () => {
        hubie_start_sprite.setVisible(false);
        hubie_end_sprite.setVisible(false);
        place_hubie_idle(newState);
        onDone();
    });
}

// Face-crossing slide transition — ported near-verbatim from GameScene.js's
// _animateTransition: build the incoming face off-screen, tween the current
// face out while the incoming face tweens in, then re-parent the incoming
// face's tile graphics onto faceContainer so it becomes "current" again.
// Used whenever a move crosses a face edge (crossed_face === true).
function animate_transition(direction, prevState, newState, onDone) {
    const gridSize = GRID * TILE + (GRID - 1) * GAP;
    const DURATION = 400;
    const dir = direction.toLowerCase();
    const tint = color_hex_map[newState.hubie_cargo];

    // How far off-screen each direction's outgoing/incoming face travels.
    const off = {
        UP:    { outX: 0, outY:  gridSize + 40, inX: 0, inY: -(gridSize + 40) },
        DOWN:  { outX: 0, outY: -(gridSize + 40), inX: 0, inY:  gridSize + 40  },
        LEFT:  { outX:  gridSize + 40, outY: 0, inX: -(gridSize + 40), inY: 0  },
        RIGHT: { outX: -(gridSize + 40), outY: 0, inX:  gridSize + 40, inY: 0  },
    }[direction];

    build_face(incomingContainer, newState.faces[0]); // pre-build the NEW face's look, off-screen
    incomingContainer.x = off.inX;
    incomingContainer.y = off.inY;
    incomingContainer.setAlpha(1);

    hubie_idle_sprite.setVisible(false);
    const fromCenter = tile_center_by_index(prevState.hubie_index);
    hubie_start_sprite.setTexture(`hubie_${dir}_start`).setTint(tint);
    hubie_start_sprite.setPosition(fromCenter.x, fromCenter.y).setVisible(true);
    hubie_start_sprite.play(`hubie_${dir}_start`);

    scene_ref.tweens.add({
        targets: faceContainer,
        x: off.outX, y: off.outY, alpha: 0,
        duration: DURATION, ease: 'Quad.easeInOut',
    });

    scene_ref.tweens.add({
        targets: incomingContainer,
        x: 0, y: 0,
        duration: DURATION, ease: 'Quad.easeInOut',
        onComplete: () => {
            // The slide is done — re-parent the incoming face's graphics
            // onto faceContainer so IT becomes "current" (rather than
            // keeping two containers alive and swapping which is "active",
            // this literally moves the children, exactly like the old code).
            faceContainer.removeAll(true);
            faceContainer.x = 0;
            faceContainer.y = 0;
            faceContainer.setAlpha(1);
            [...incomingContainer.list].forEach(child => {
                incomingContainer.remove(child, false);
                faceContainer.add(child);
            });
            tileGraphics = [...faceContainer.list];
            incomingContainer.setAlpha(0);

            hubie_start_sprite.setVisible(false);
            const entryCenter = tile_center_by_index(newState.hubie_index);
            hubie_end_sprite.setTexture(`hubie_${dir}_end`).setTint(tint);
            hubie_end_sprite.setPosition(entryCenter.x, entryCenter.y).setVisible(true);
            hubie_end_sprite.play(`hubie_${dir}_end`);

            hubie_end_sprite.once('animationcomplete', () => {
                hubie_end_sprite.setVisible(false);
                place_hubie_idle(newState);
                onDone();
            });
        }
    });
}

// SWAP has no motion — just recolor the tile Hubie is standing on, and
// retint whichever Hubie sprite is currently active/idle.
function execute_swap_visual(newState) {
    draw_tile(tileGraphics[newState.hubie_index], color_hex_map[newState.faces[0][newState.hubie_index]], TILE);
    const tint = color_hex_map[newState.hubie_cargo];
    hubie_idle_sprite.setTint(tint);
    hubie_start_sprite.setTint(tint);
    hubie_end_sprite.setTint(tint);
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: FACE TRACKER
// The 6-box "which colors are solved" indicator across the top of the
// screen. Ported from the old project's FaceTracker.js, keyed the way the
// original actually was: the old GameScene called
// `faceTracker.fillSlot(cmd.colorIndex, cmd.color)` — a COLOR index, not a
// face index. Each of the 6 slots is permanently dedicated to one color's
// identity (FACE_TRACKER_COLORS below) and lights up whenever ANY face
// currently showing that color is complete — so the same visual slot means
// the same color for the whole game, regardless of which physical face
// (FRONT/BACK/etc.) happens to be that color this time around.
//
// Which boxes are lit is decided by the engine (state.bar, and bar_lit /
// bar_dark after each key press); this section only draws them.
// ═══════════════════════════════════════════════════════════════════════

const FACE_TRACKER_SLOT = 22;
const FACE_TRACKER_GAP = 6;

// Left-to-right box colors — must match BAR_COLORS in rust/src/lib.rs.
const FACE_TRACKER_COLORS = ['green', 'white', 'yellow', 'red', 'blue', 'orange'];

function build_face_tracker(scene) {
    const total = 6 * FACE_TRACKER_SLOT + 5 * FACE_TRACKER_GAP;
    const startX = (scene.scale.width - total) / 2;
    const y = 12;

    face_tracker_slots = [];
    for (let c = 0; c < 6; c++) {
        const g = scene.add.graphics();
        g.x = startX + c * (FACE_TRACKER_SLOT + FACE_TRACKER_GAP);
        g.y = y;
        draw_face_tracker_empty(g, FACE_TRACKER_SLOT);
        face_tracker_slots.push({ g, size: FACE_TRACKER_SLOT });
    }
}

function draw_face_tracker_empty(g, size) {
    g.clear();
    g.lineStyle(1.5, 0x444466, 1);
    g.fillStyle(0x111122, 1);
    g.fillRect(0, 0, size, size);
    g.strokeRect(0, 0, size, size);
}

function draw_face_tracker_filled(g, hexColor, size) {
    g.clear();
    g.fillStyle(hexColor, 1);
    g.fillRect(0, 0, size, size);
    g.fillStyle(0x000000, 0.15);
    g.fillRect(0, size - 3, size, 3);
    g.fillRect(size - 3, 0, 3, size);
}

// The pop animation from the old FaceTracker.fillSlot — scale down, then
// bounce past 1.0 and settle back, via two chained tweens. Fires every
// time a box lights.
function pop_face_tracker_slot(g) {
    g.setScale(0.5);
    scene_ref.tweens.add({
        targets: g,
        scaleX: 1.15, scaleY: 1.15,
        duration: 120,
        ease: 'Back.easeOut',
        onComplete: () => {
            scene_ref.tweens.add({
                targets: g,
                scaleX: 1, scaleY: 1,
                duration: 80,
            });
        }
    });
}

// Paints all 6 boxes from a lit/unlit list (first paint on load).
function paint_face_tracker(bar) {
    for (let c = 0; c < 6; c++) {
        const slot = face_tracker_slots[c];
        if (bar[c]) {
            draw_face_tracker_filled(slot.g, color_hex_map[FACE_TRACKER_COLORS[c]], slot.size);
        } else {
            draw_face_tracker_empty(slot.g, slot.size);
        }
    }
}

// Lights / darkens the boxes the engine says just changed.
function update_face_tracker(lit, dark) {
    for (const c of lit) {
        const slot = face_tracker_slots[c];
        draw_face_tracker_filled(slot.g, color_hex_map[FACE_TRACKER_COLORS[c]], slot.size);
        pop_face_tracker_slot(slot.g);
    }
    for (const c of dark) {
        const slot = face_tracker_slots[c];
        draw_face_tracker_empty(slot.g, slot.size);
    }
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: WIN SEQUENCE
// Shown when the engine reports a win (the engine also stops accepting
// keys from then on): the "Cube Solved!" overlay with its "Play" button.
// ═══════════════════════════════════════════════════════════════════════

function trigger_win_sequence() {
    const overlay = document.getElementById('win-overlay');
    if (overlay) overlay.classList.add('visible');

    const pauseBtn = document.getElementById('pause-btn');
    if (pauseBtn) pauseBtn.disabled = true; // nothing left to pause once the game is over
}
// Note: the "Play" button's actual reload action is wired directly in
// index.html (onclick="location.reload()") — reloading the page is the
// simplest, guaranteed-correct way to reset EVERY piece of state at once,
// rather than writing a separate manual reset path.


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: PAUSE MENU
// The "Pause" button (top-left of the game canvas) opens a modal with a
// Restart choice, plus a close (×) to resume without restarting. While it's
// open the engine ignores keys; after a win the engine refuses to pause.
// ═══════════════════════════════════════════════════════════════════════

function openPauseMenu() {
    if (!engine.pause(true)) return;
    const modal = document.getElementById('pause-modal');
    if (modal) modal.classList.add('visible');
}

function closePauseMenu() {
    engine.pause(false);
    const modal = document.getElementById('pause-modal');
    if (modal) modal.classList.remove('visible');
}

// "Restart" — same full-reload approach as the win screen's Play button,
// for the same reason (guaranteed to reset every piece of state at once).
function pauseMenuRestart() {
    location.reload();
}


// ═══════════════════════════════════════════════════════════════════════
// FEATURE: INPUT
// Every keystroke goes to the engine, which answers with what to show:
// nothing, a blocked bump, a walk, a face slide, or a swap — plus which
// faces-bar boxes changed and whether to play the face-done / win sounds.
// After a walk or slide the engine keeps input locked until this file
// reports the animation finished (engine.done()).
// ═══════════════════════════════════════════════════════════════════════

function handle_key(key) {
    const prevState = engine.get_state_snapshot();
    const ev = engine.press(key);
    if (ev.action === 'none') return;

    const state = engine.get_state_snapshot();
    const finished = () => engine.done();

    if (ev.action === 'swap') {
        game_sound.playSwap();
        execute_swap_visual(state);
        update_face_tracker(ev.bar_lit, ev.bar_dark);
        if (ev.face_done) game_sound.playFaceComplete();
        if (ev.win) {
            game_sound.playWin();
            trigger_win_sequence();
        }
    } else if (ev.action === 'blocked') {
        game_sound.playBlocked();
    } else if (ev.action === 'slide') {
        game_sound.playFaceTransition(ev.direction);
        animate_transition(ev.direction, prevState, state, finished);
    } else if (ev.action === 'walk') {
        game_sound.playMove(ev.direction);
        animate_move(ev.direction, prevState, state, finished);
    }
}
