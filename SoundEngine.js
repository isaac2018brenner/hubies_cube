/**
 * SoundEngine.js
 *
 * Ported from the old project's src/SoundEngine.js, unchanged. This file
 * never touches cube state or game rules — it's a thin dictionary mapping
 * named events to Phaser sound playback. main.js calls these methods
 * in response to what engine.js's handle_input() packet reports happened;
 * this file has no idea what a "move" or a "cube" even is.
 *
 * Sound file → game event mapping:
 *   start_of_game.mp3            → game loads
 *   walk_tile_to_tile.mp3        → any tile-to-tile move (all 4 directions)
 *   face_turn_up.mp3             → face transition UP
 *   face_turn_down.mp3           → face transition DOWN
 *   face_turn_left.mp3           → face transition LEFT
 *   face_turn_right.mp3          → face transition RIGHT
 *   color_swap.mp3               → space bar swap
 *   same_color.mp3               → blocked move (same color tile)
 *   face_one_color_finished.mp3  → a face is fully one color
 *   cube_solved.mp3              → all 6 faces solved — game won
 */

class SoundEngine {
  constructor(scene) {
    this.scene   = scene;
    this.sounds  = {};
  }

  // Called from preload() — loads all MP3s into Phaser
  static preload(scene) {
    const base = 'assets/sound_effects/';
    scene.load.audio('snd_start',         base + 'start_of_game.mp3');
    scene.load.audio('snd_walk',          base + 'walk_tile_to_tile.mp3');
    scene.load.audio('snd_turn_up',       base + 'face_turn_up.mp3');
    scene.load.audio('snd_turn_down',     base + 'face_turn_down.mp3');
    scene.load.audio('snd_turn_left',     base + 'face_turn_left.mp3');
    scene.load.audio('snd_turn_right',    base + 'face_turn_right.mp3');
    scene.load.audio('snd_swap',          base + 'color_swap.mp3');
    scene.load.audio('snd_blocked',       base + 'same_color.mp3');
    scene.load.audio('snd_face_done',     base + 'face_one_color_finished.mp3');
    scene.load.audio('snd_win',           base + 'cube_solved.mp3');
  }

  // Called from create() — creates Phaser sound objects
  init() {
    const add = (key) => this.scene.sound.add(key, { volume: 0.8 });
    this.sounds = {
      start:    add('snd_start'),
      walk:     add('snd_walk'),
      turnUp:   add('snd_turn_up'),
      turnDown: add('snd_turn_down'),
      turnLeft: add('snd_turn_left'),
      turnRight:add('snd_turn_right'),
      swap:     add('snd_swap'),
      blocked:  add('snd_blocked'),
      faceDone: add('snd_face_done'),
      win:      add('snd_win'),
    };
  }

  _play(key) {
    const snd = this.sounds[key];
    if (snd) snd.play();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  playLoad()           { this._play('start');    }
  playSwap()           { this._play('swap');      }
  playBlocked()        { this._play('blocked');   }
  playFaceComplete()   { this._play('faceDone');  }
  playWin()            { this._play('win');       }

  playMove(direction) {
    // All tile-to-tile moves use the same walk sound
    this._play('walk');
  }

  playFaceTransition(direction) {
    switch (direction) {
      case 'UP':    this._play('turnUp');    break;
      case 'DOWN':  this._play('turnDown');  break;
      case 'LEFT':  this._play('turnLeft');  break;
      case 'RIGHT': this._play('turnRight'); break;
    }
  }
}

window.SoundEngine = SoundEngine;
