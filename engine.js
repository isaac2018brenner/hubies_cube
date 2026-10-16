// ═══════════════════════════════════════════════════════════════════════
// ENGINE.JS — thin bridge to the game's brain, which lives in engine.wasm
// (compiled from rust/src/lib.rs). This file holds no game rules and makes
// no game decisions: it hands key names to the .wasm and translates the
// numbers it returns into plain objects main.js can act on.
//
// Load once before starting the game:   await CubeEngine.load();
// Then:  new CubeEngine(seed?)  → new random cube (same seed = same cube)
//        press(key)             → what to show for this key (see below)
//        done()                 → an animation / the start sound finished
//        pause(on)              → open/close pause; false = not allowed
//        get_state_snapshot()   → what to draw
// ═══════════════════════════════════════════════════════════════════════

// Colors as the .wasm numbers them (0-5).
const COLOR_NAMES = ["red", "orange", "white", "yellow", "green", "blue"];
const ACTIONS = ["none", "blocked", "walk", "slide", "swap"];
const DIRECTIONS = ["UP", "DOWN", "LEFT", "RIGHT"];

let wasm = null; // the loaded engine.wasm exports
const key_encoder = new TextEncoder();

class CubeEngine {
    // source: URL of the .wasm (browser), or its bytes (tests).
    static async load(source = 'engine.wasm') {
        const bytes = typeof source === 'string'
            ? await (await fetch(source)).arrayBuffer()
            : source;
        const { instance } = await WebAssembly.instantiate(bytes, {});
        wasm = instance.exports;
    }

    // seed: optional whole number. Same seed = same starting cube.
    constructor(seed) {
        this.FRONT = 0;
        this.seed = Number.isInteger(seed) ? seed >>> 0 : Math.floor(Math.random() * 4294967296);
        wasm.init(this.seed);
    }

    // Returns { action, direction, face_done, win, bar_lit, bar_dark }
    //   action:    "none" | "blocked" | "walk" | "slide" | "swap"
    //   direction: "UP" | "DOWN" | "LEFT" | "RIGHT" (walk / slide / blocked)
    //   face_done: play the face-done sound
    //   win:       play the win sound and show the win screen
    //   bar_lit / bar_dark: faces-bar boxes (0-5) that just changed
    press(key) {
        const bytes = key_encoder.encode(key);
        const buf = new Uint8Array(wasm.memory.buffer, wasm.key_buf(), 16);
        if (bytes.length <= 16) buf.set(bytes);
        const ev = wasm.press(bytes.length);
        const boxes = shift => [0, 1, 2, 3, 4, 5].filter(c => (ev >> (shift + c)) & 1);
        const action = ACTIONS[ev & 7];
        const is_move = action === 'walk' || action === 'slide' || action === 'blocked';
        return {
            action,
            direction: is_move ? DIRECTIONS[(ev >> 3) & 3] : undefined,
            face_done: (ev & (1 << 5)) !== 0,
            win: (ev & (1 << 6)) !== 0,
            bar_lit: boxes(8),
            bar_dark: boxes(16),
        };
    }

    done() { wasm.done(); }

    pause(on) { return wasm.pause(on ? 1 : 0) === 1; }

    get locked() { return (wasm.status() & 1) !== 0; }
    get paused() { return (wasm.status() & 2) !== 0; }
    get game_over() { return (wasm.status() & 4) !== 0; }

    // { faces, hubie_face, hubie_index, hubie_cargo, completed_faces, solved, bar }
    get_state_snapshot() {
        const s = new Uint8Array(wasm.memory.buffer, wasm.state(), 59);
        const faces = [];
        for (let f = 0; f < 6; f++) {
            const face = [];
            for (let i = 0; i < 9; i++) face.push(COLOR_NAMES[s[f * 9 + i]]);
            faces.push(face);
        }
        const bits = (byte) => [0, 1, 2, 3, 4, 5].map(i => (byte & (1 << i)) !== 0);
        return {
            faces,
            hubie_face: this.FRONT,
            hubie_index: s[54],
            hubie_cargo: COLOR_NAMES[s[55]],
            completed_faces: bits(s[56]),
            solved: s[57] === 1,
            bar: bits(s[58])
        };
    }

    get faces() { return this.get_state_snapshot().faces; }
}

if (typeof module !== 'undefined') module.exports = { CubeEngine }; // for node tests
