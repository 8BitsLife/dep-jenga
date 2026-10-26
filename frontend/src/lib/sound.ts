// Procedural sound design: every click, knock and rumble is synthesized with WebAudio, so the app
// ships no audio assets. Paired with navigator.vibrate on devices that support it.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('depjenga.muted') === '1';
  } catch {
    return false;
  }
})();
const last: Record<string, number> = {};

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function throttle(key: string, ms: number) {
  const now = performance.now();
  if (now - (last[key] ?? 0) < ms) return false;
  last[key] = now;
  return true;
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function env(c: AudioContext, peak: number, attack: number, decay: number, t = c.currentTime) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(master!);
  return g;
}

export function vibrate(pattern: number | number[]) {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

export const sfx = {
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem('depjenga.muted', m ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (m && ctx) void ctx.suspend();
    if (!m && ctx) void ctx.resume();
  },

  /** Tiny glassy tick for hovers. */
  tick(pitch = 1) {
    const c = ac();
    if (!c || !throttle('tick', 35)) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2200 * pitch;
    o.connect(env(c, 0.05, 0.002, 0.03));
    o.start();
    o.stop(c.currentTime + 0.05);
  },

  /** Squishy UI press. */
  pop(pitch = 1) {
    const c = ac();
    if (!c || !throttle('pop', 30)) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(720 * pitch, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(180 * pitch, c.currentTime + 0.09);
    o.connect(env(c, 0.22, 0.004, 0.1));
    o.start();
    o.stop(c.currentTime + 0.14);
    vibrate(8);
  },

  /** Wooden knock — selecting a block. */
  tock(pitch = 1, vol = 1) {
    const c = ac();
    if (!c || !throttle('tock', 25)) return;
    const n = noise(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 * pitch;
    bp.Q.value = 6;
    n.connect(bp).connect(env(c, 0.5 * vol, 0.001, 0.06));
    n.start(c.currentTime, Math.random());
    n.stop(c.currentTime + 0.1);
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240 * pitch, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(120 * pitch, c.currentTime + 0.08);
    o.connect(env(c, 0.35 * vol, 0.002, 0.09));
    o.start();
    o.stop(c.currentTime + 0.12);
  },

  /** Physics collision clack; volume follows impact strength. */
  clack(strength: number) {
    const c = ac();
    if (!c || !throttle('clack', 45)) return;
    const v = Math.min(1, strength);
    if (v < 0.08) return;
    this.tock(0.7 + Math.random() * 0.6, v * 0.8);
  },

  whoosh() {
    const c = ac();
    if (!c || !throttle('whoosh', 120)) return;
    const n = noise(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(3200, c.currentTime + 0.28);
    n.connect(f).connect(env(c, 0.35, 0.05, 0.3));
    n.start();
    n.stop(c.currentTime + 0.4);
    vibrate([12, 30, 20]);
  },

  rumble(seconds = 1.4) {
    const c = ac();
    if (!c || !throttle('rumble', 500)) return;
    const n = noise(c);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    n.connect(lp).connect(env(c, 0.9, 0.04, seconds));
    n.start();
    n.stop(c.currentTime + seconds + 0.1);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(32, c.currentTime + seconds);
    o.connect(env(c, 0.5, 0.02, seconds));
    o.start();
    o.stop(c.currentTime + seconds + 0.1);
    vibrate([60, 40, 90, 40, 140]);
  },

  /** Rising charge while holding to pull. */
  charge(progress: number) {
    const c = ac();
    if (!c || !throttle('charge', 70)) return;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 220 + progress * 660;
    o.connect(env(c, 0.07, 0.005, 0.06));
    o.start();
    o.stop(c.currentTime + 0.08);
  },

  /** Little major-seventh arpeggio when the tower finishes building. */
  chime() {
    const c = ac();
    if (!c) return;
    [523.25, 659.25, 783.99, 987.77].forEach((f, i) => {
      const t = c.currentTime + i * 0.07;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(env(c, 0.14, 0.01, 0.6, t));
      o.start(t);
      o.stop(t + 0.7);
    });
    vibrate([10, 40, 10]);
  },

  error() {
    const c = ac();
    if (!c) return;
    [220, 165].forEach((f, i) => {
      const t = c.currentTime + i * 0.12;
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(env(c, 0.06, 0.005, 0.14, t));
      o.start(t);
      o.stop(t + 0.2);
    });
    vibrate([40, 60, 40]);
  },
};
