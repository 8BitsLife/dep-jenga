import { useEffect, useRef, useState } from 'react';
import { whenSceneReady } from '../lib/boot';

/**
 * Opening screen, drawn on one 2D canvas so a couple of thousand blocks stay smooth: a wall of white Jenga
 * blocks with orange ripples rolling out from the centre while the site loads behind it, then a quick
 * clean cut to the site.
 */

const MIN_MS = 2200; // people should actually get to see it
const MAX_WAIT_MS = 7000; // never hold the site hostage
const RING_EVERY_MS = 820;
const CUT_MS = 220;

const IVORY: [number, number, number] = [242, 230, 214];
const ORANGE: [number, number, number] = [255, 122, 47];

interface Block {
  x: number;
  y: number;
  d: number; // distance from centre
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`;

export function Intro({ onReveal }: { onReveal: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const hasRound = typeof ctx.roundRect === 'function';

    // ---------------------------------------------------------------- the wall
    const cx = W / 2;
    const cy = H / 2;
    const bw = clamp(W / 21, 30, 66);
    const bh = bw / 3;
    const gap = Math.max(5, bw * 0.22);
    const colW = bw + gap;
    const rowH = bh + gap;
    const radius = Math.min(3, bh * 0.32);
    const blocks: Block[] = [];
    for (let r = 0, y = -rowH / 2; y < H + rowH; r++, y += rowH) {
      const off = r % 2 ? colW / 2 : 0;
      for (let x = -colW + off; x < W + colW; x += colW) {
        const bx = x + bw / 2;
        const by = y + bh / 2;
        blocks.push({ x: bx, y: by, d: Math.hypot(bx - cx, by - cy) });
      }
    }
    const maxD = Math.hypot(cx, cy) + 40;
    const ringSpeed = maxD / 2.1; // px per second
    const ringWidth = Math.max(34, bw * 0.95);

    // ---------------------------------------------------------------- readiness: the scene behind is built and the page has loaded
    const start = performance.now();
    let ready = false;
    const pageLoaded =
      document.readyState === 'complete' ? Promise.resolve() : new Promise<void>((r) => window.addEventListener('load', () => r(), { once: true }));
    Promise.race([Promise.all([whenSceneReady(), pageLoaded]), new Promise((r) => setTimeout(r, MAX_WAIT_MS))]).then(() => (ready = true));

    const drawBlock = (x: number, y: number, w: number, h: number, rgb: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath();
      if (hasRound) ctx.roundRect(x - w / 2, y - h / 2, w, h, radius);
      else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();
      // matte block shading: a soft lower lip
      ctx.fillStyle = 'rgba(40,30,25,0.12)';
      ctx.fillRect(x - w / 2 + radius * 0.5, y + h * 0.2, w - radius, h * 0.28);
    };

    const backdrop = ctx.createRadialGradient(cx, cy * 0.95, 0, cx, cy, maxD);
    backdrop.addColorStop(0, '#221b1c');
    backdrop.addColorStop(1, '#100e12');

    let raf = 0;
    let cut = false;
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      // warm studio light behind the wall, falling off toward the corners
      ctx.globalAlpha = 1;
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, W, H);

      // live ripple rings
      const rings: number[] = [];
      if (!reduced) {
        for (let k = 0; k * RING_EVERY_MS <= t; k++) {
          const r = ((t - k * RING_EVERY_MS) / 1000) * ringSpeed;
          if (r > 0 && r < maxD + ringWidth) rings.push(r);
        }
      }
      // soft orange glow travelling with each ring
      for (const r of rings) {
        const fade = 1 - r / maxD;
        if (fade <= 0) continue;
        const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - ringWidth * 1.6), cx, cy, r + ringWidth * 1.6);
        g.addColorStop(0, 'rgba(255,122,47,0)');
        g.addColorStop(0.5, `rgba(255,110,40,${0.1 * fade})`);
        g.addColorStop(1, 'rgba(255,122,47,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      // the centre breathes in time with the waves so their origin reads
      if (!reduced) {
        const pulse = 0.5 + 0.5 * Math.sin((t / RING_EVERY_MS) * Math.PI * 2);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, bw * 4.5);
        g.addColorStop(0, `rgba(255,122,47,${0.14 + 0.1 * pulse})`);
        g.addColorStop(1, 'rgba(255,122,47,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      for (const b of blocks) {
        let I = 0;
        for (const r of rings) {
          const fade = 1 - r / maxD;
          if (fade > 0) I += Math.exp(-Math.pow((b.d - r) / ringWidth, 2)) * fade;
        }
        I = clamp(I);
        // calm ivory at rest, dimmer toward the edges; a passing wave lifts the block (casting a soft
        // shadow below it) and its crest runs orange
        const edge = 1 - 0.45 * Math.pow(clamp(b.d / maxD), 1.4);
        const heat = clamp((I - 0.28) / 0.5);
        const s = 1 + I * 0.1;
        const lift = I * bh * 0.7;
        if (lift > 0.5) {
          ctx.globalAlpha = 0.35 * I;
          ctx.fillStyle = '#060507';
          ctx.fillRect(b.x - (bw * s) / 2 + 1, b.y - (bh * s) / 2 + 2, bw * s - 2, bh * s);
        }
        drawBlock(b.x, b.y - lift, bw * s, bh * s, mix(IVORY, ORANGE, heat * heat * (3 - 2 * heat)), (0.56 + 0.44 * I) * edge + I * (1 - edge));
      }
      ctx.globalAlpha = 1;

      if (!cut && ready && t >= (reduced ? 600 : MIN_MS)) {
        cut = true;
        setLeaving(true);
        revealRef.current();
        window.setTimeout(() => setGone(true), CUT_MS + 40);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (gone) return null;
  return (
    <div className={`intro ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <canvas ref={ref} />
      <span className="sr-only">Loading DepJenga</span>
    </div>
  );
}
