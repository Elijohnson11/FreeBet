// ═══════════════════════════════════════════
//   FreeBet — sounds.js
//   All audio synthesized via Web Audio API
//   No external files required
// ═══════════════════════════════════════════

const SFX = (() => {
  let ctx  = null;
  let mute = false;

  // Lazy-init AudioContext (browser autoplay policy requires user gesture first)
  function C() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Create a gain node connected to destination, respects mute
  function out(vol = 1) {
    const c = C();
    const g = c.createGain();
    g.gain.value = mute ? 0 : vol;
    g.connect(c.destination);
    return { c, g };
  }

  // ── Oscillator tone with ADSR envelope ──
  function osc(freq, type, startAt, dur, peak = 0.3, { attack = 0.006, pitchEnd = null } = {}) {
    const { c, g } = out();
    const t   = c.currentTime + startAt;
    const o   = c.createOscillator();
    o.type    = type;
    o.frequency.setValueAtTime(freq, t);
    if (pitchEnd) o.frequency.exponentialRampToValueAtTime(pitchEnd, t + dur);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ── White / pink noise burst ──
  function noise(startAt, dur, peak = 0.2, bandHz = null, Q = 1) {
    const { c, g } = out();
    const frames   = Math.ceil(c.sampleRate * (dur + 0.05));
    const buf      = c.createBuffer(1, frames, c.sampleRate);
    const d        = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
    const src      = c.createBufferSource();
    src.buffer     = buf;
    const t        = c.currentTime + startAt;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (bandHz) {
      const f = c.createBiquadFilter();
      f.type  = 'bandpass';
      f.frequency.value = bandHz;
      f.Q.value = Q;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ── Metallic coin using inharmonic partials ──
  function coinPing(startAt = 0, pitchMult = 1) {
    if (mute) return;
    const base = (1900 + Math.random() * 250) * pitchMult;
    // Inharmonic overtone series gives metal "ring"
    const partials = [[1, 0.28, 0.22], [2.76, 0.14, 0.12], [5.40, 0.07, 0.08], [8.93, 0.04, 0.05]];
    partials.forEach(([ratio, amp, decay]) => {
      osc(base * ratio, 'sine', startAt, decay / ratio + 0.04, amp);
    });
    // Transient click
    noise(startAt, 0.016, 0.1, base * 0.4, 0.6);
  }

  // ────────────────────────────────────────
  return {

    get muted() { return mute; },
    toggleMute() { mute = !mute; return mute; },

    // ── UI click — crisp tick ──
    click() {
      if (mute) return;
      osc(1100, 'sine',   0,     0.035, 0.12, { attack: 0.002 });
      osc(2200, 'square', 0,     0.018, 0.05, { attack: 0.001 });
      noise(0, 0.018, 0.055);
    },

    // ── Color swatch pick ──
    colorPick() {
      if (mute) return;
      osc(660, 'sine', 0, 0.08, 0.15, { attack: 0.003 });
      osc(990, 'sine', 0, 0.05, 0.08, { attack: 0.003 });
    },

    // ── Player sits down — wood thud ──
    sitDown() {
      if (mute) return;
      osc(90,  'sine', 0,    0.22, 0.55, { attack: 0.004, pitchEnd: 45 });
      osc(170, 'sine', 0.02, 0.12, 0.22, { attack: 0.003 });
      noise(0, 0.09, 0.22, 180, 0.6);
    },

    // ── Game start — rising casino chord ──
    gameStart() {
      if (mute) return;
      [[261.6, 0], [329.6, 0.07], [392.0, 0.14], [523.2, 0.21]].forEach(([f, t]) => {
        osc(f, 'sine', t, 0.7, 0.22, { attack: 0.012 });
      });
      noise(0.28, 0.06, 0.12, 1200, 0.5);
    },

    // ── Single coin clink ──
    coin(when = 0) { coinPing(when); },

    // ── Multiple coins sliding to center pot ──
    coinsToCenter(count = 3) {
      if (mute) return;
      const n = Math.min(count, 7);
      for (let i = 0; i < n; i++) {
        coinPing(i * 0.072 + Math.random() * 0.018);
      }
    },

    // ── Coin shower flying to winner ──
    coinsToWinner(count = 8) {
      if (mute) return;
      const n = Math.min(count, 14);
      for (let i = 0; i < n; i++) {
        coinPing(i * 0.048 + Math.random() * 0.012, 0.88 + Math.random() * 0.24);
      }
    },

    // ── Bet created — card flip + chip settle ──
    betCreated() {
      if (mute) return;
      noise(0,    0.045, 0.28, 3200, 0.9);  // card flip swipe
      noise(0.04, 0.035, 0.18, 2000, 0.7);  // card land
      noise(0.08, 0.035, 0.12, 1200, 0.5);  // card settle
      osc(580, 'triangle', 0.1,  0.09, 0.28, { attack: 0.003 }); // chip thud
      osc(820, 'sine',     0.12, 0.06, 0.16, { attack: 0.002 });
    },

    // ── Join straight bet ──
    joinBet() {
      if (mute) return;
      this.coinsToCenter(3);
      osc(440, 'sine', 0.28, 0.16, 0.18, { attack: 0.012 });
      osc(550, 'sine', 0.36, 0.10, 0.13, { attack: 0.008 });
    },

    // ── Pick OVER — ascending tones ──
    pickOver() {
      if (mute) return;
      osc(440, 'sine', 0,    0.10, 0.20, { attack: 0.005 });
      osc(554, 'sine', 0.09, 0.10, 0.18, { attack: 0.005 });
      osc(659, 'sine', 0.18, 0.16, 0.16, { attack: 0.005 });
      this.coinsToCenter(2);
    },

    // ── Pick UNDER — descending tones ──
    pickUnder() {
      if (mute) return;
      osc(659, 'sine', 0,    0.10, 0.20, { attack: 0.005 });
      osc(554, 'sine', 0.09, 0.10, 0.18, { attack: 0.005 });
      osc(440, 'sine', 0.18, 0.16, 0.16, { attack: 0.005 });
      this.coinsToCenter(2);
    },

    // ── Pass — soft descending dud ──
    pass() {
      if (mute) return;
      osc(310, 'sine', 0,    0.14, 0.18, { attack: 0.006, pitchEnd: 220 });
      noise(0.04, 0.05, 0.06);
    },

    // ── Drum roll — accelerating snare ──
    drumRoll() {
      if (mute) return;
      for (let i = 0; i < 10; i++) {
        const t = i * 0.062 + i * i * 0.0015; // accelerates
        noise(t,        0.032, 0.13 + i * 0.01, 260, 0.9);
        osc(175 + i * 7, 'sine', t, 0.028, 0.08 + i * 0.008, { attack: 0.002 });
      }
    },

    // ── Winner fanfare — trumpet bugle call ──
    fanfare() {
      if (mute) return;
      // Classic cavalry charge / bugle call:  G  G  G  Eb  Bb  G  Eb  Bb  G(high)
      const melody = [
        [392.0, 0.00, 0.11],
        [392.0, 0.14, 0.11],
        [392.0, 0.28, 0.11],
        [311.1, 0.42, 0.18],  // Eb4 — dip
        [466.2, 0.63, 0.11],  // Bb4 — up
        [392.0, 0.77, 0.18],  // G4 — return
        [311.1, 0.98, 0.18],  // Eb4 — dip again
        [466.2, 1.19, 0.11],  // Bb4
        [784.0, 1.33, 0.70],  // G5  — triumphant hold
      ];

      const c = C();
      melody.forEach(([freq, when, dur]) => {
        const t   = c.currentTime + when;
        const env = c.createGain();
        env.gain.setValueAtTime(0.001, t);
        env.gain.linearRampToValueAtTime(0.28, t + 0.016);
        env.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.12);

        // Sawtooth for brass timbre
        const o1 = c.createOscillator();
        o1.type  = 'sawtooth';
        o1.frequency.setValueAtTime(freq, t);

        // Bandpass shapes the "bell" of a trumpet
        const bp = c.createBiquadFilter();
        bp.type  = 'bandpass';
        bp.frequency.setValueAtTime(freq * 2.8, t);
        bp.Q.value = 2.2;

        // Octave harmonic (slightly quieter square)
        const o2  = c.createOscillator();
        o2.type   = 'square';
        o2.frequency.setValueAtTime(freq * 2, t);
        const env2 = c.createGain();
        env2.gain.setValueAtTime(0.001, t);
        env2.gain.linearRampToValueAtTime(0.06, t + 0.016);
        env2.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);

        o1.connect(bp); bp.connect(env); env.connect(c.destination);
        o2.connect(env2); env2.connect(c.destination);
        o1.start(t); o1.stop(t + dur + 0.2);
        o2.start(t); o2.stop(t + dur + 0.15);
      });

      // Snare + crash cymbal on the triumphant hold
      noise(1.40, 0.07, 0.32, 280, 1.0);   // snare crack
      noise(1.40, 0.90, 0.12, 9000, 0.25); // cymbal wash
      noise(1.45, 0.50, 0.08, 6000, 0.18); // cymbal decay
    },

    // ── Modal open — soft whoosh ──
    modalOpen() {
      if (mute) return;
      noise(0, 0.12, 0.14, 800, 0.4);
      osc(320, 'sine', 0.02, 0.12, 0.1, { attack: 0.01, pitchEnd: 480 });
    },

    // ── Overlay dismiss — soft close ──
    dismiss() {
      if (mute) return;
      osc(480, 'sine', 0, 0.1, 0.12, { attack: 0.003, pitchEnd: 280 });
      noise(0, 0.08, 0.08);
    },

  };
})();
