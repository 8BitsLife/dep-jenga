import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RISK_COLOR, SEV_META, SEV_ORDER } from '../lib/severity';
import { sfx } from '../lib/sound';
import type { PackageNode, Severity } from '../lib/types';
import { useStore } from '../store';

interface N extends SimulationNodeDatum {
  id: string;
  p?: PackageNode;
  r: number;
}
type L = SimulationLinkDatum<N>;
type Palette = 'colour' | 'plain';
type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = ([r, g, b]: RGB, t: number) =>
  t >= 0
    ? `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`
    : `rgb(${Math.round(r * (1 + t))},${Math.round(g * (1 + t))},${Math.round(b * (1 + t))})`;

const IVORY = hex('#e6dacb');
const CLEAN_HEX = '#7fd4a8'; // colour mode only: no known advisories
const CLEAN = hex(CLEAN_HEX);
const UNSCANNED = hex('#55505c');
const ROOT = hex('#ff4436');
const SEV_RGB = Object.fromEntries(SEV_ORDER.map((k) => [k, hex(SEV_META[k].color)])) as Record<Severity, RGB>;
const PALETTE_KEY = 'depjenga.graphPalette';

function bodyColour(p: PackageNode | undefined, palette: Palette): RGB {
  if (!p) return ROOT;
  if (p.severity === 'NOT_SCANNED') return UNSCANNED;
  if (palette === 'plain') return IVORY;
  return p.vulns.length ? SEV_RGB[p.severity] : CLEAN;
}

/** A lit sphere: soft contact shadow, key light from the top left, darker rim, small specular highlight. */
function sphere(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB) {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.18, y + r * 0.32, r * 0.95, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
  g.addColorStop(0, shade(c, 0.6));
  g.addColorStop(0.35, shade(c, 0.08));
  g.addColorStop(0.8, shade(c, -0.32));
  g.addColorStop(1, shade(c, -0.55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function readPalette(): Palette {
  try {
    return localStorage.getItem(PALETTE_KEY) === 'plain' ? 'plain' : 'colour';
  } catch {
    return 'colour';
  }
}

/** Force-directed dependency graph on a canvas. Sphere size = blast radius, colour = severity, ring = bus-factor risk. */
export function GraphView() {
  const r = useStore((s) => s.result)!;
  const selectedId = useStore((s) => s.selectedId);
  const blastId = useStore((s) => s.blastId);
  const blastSet = useStore((s) => s.blastSet);
  const select = useStore((s) => s.select);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<N | null>(null);
  const [onlyVuln, setOnlyVuln] = useState(false);
  const [palette, setPalette] = useState<Palette>(readPalette);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const state = useRef({ selectedId, blastId, blastSet, hover: null as N | null, palette });
  state.current = { selectedId, blastId, blastSet, hover, palette };

  const { nodes, links } = useMemo(() => {
    let pk = r.packages;
    if (onlyVuln) {
      // vulnerable packages plus every package on a path to them
      const keep = new Set<string>();
      const parents = new Map<string, string[]>();
      r.edges.forEach((e) => {
        if (!parents.has(e.to)) parents.set(e.to, []);
        parents.get(e.to)!.push(e.from);
      });
      const q = r.packages.filter((p) => p.vulns.length).map((p) => p.id);
      q.forEach((id) => keep.add(id));
      while (q.length) {
        const cur = q.shift()!;
        for (const p of parents.get(cur) ?? []) if (!keep.has(p)) (keep.add(p), q.push(p));
      }
      pk = r.packages.filter((p) => keep.has(p.id));
    }
    const ids = new Set(pk.map((p) => p.id));
    // sqrt keeps hubs readable without a few giants swallowing the canvas
    const nodes: N[] = [
      { id: r.rootId, r: 18, fx: 0, fy: 0 },
      ...pk.map((p) => ({ id: p.id, p, r: Math.min(26, 4.5 + Math.sqrt(p.transitiveDependents) * 2.2 + (p.vulns.length ? 1.5 : 0)) })),
    ];
    const links: L[] = r.edges.filter((e) => (e.from === r.rootId || ids.has(e.from)) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
    return { nodes, links };
  }, [r, onlyVuln]);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    let w = 0, h = 0;
    const resize = () => {
      const rect = wrap.current!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      c.width = w * devicePixelRatio;
      c.height = h * devicePixelRatio;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);

    const sim = forceSimulation<N>(nodes)
      .force(
        'link',
        forceLink<N, L>(links)
          .id((d) => d.id)
          .distance((l) => ((l.source as N).id === r.rootId ? 90 : 22 + ((l.source as N).r + (l.target as N).r) * 0.9))
          .strength(0.5),
      )
      .force('charge', forceManyBody<N>().strength((d) => -50 - d.r * 4))
      .force('collide', forceCollide<N>().radius((d) => d.r + 3))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.025);

    // small spheres first so hubs sit on top of their neighbours
    const order = [...nodes].sort((a, b) => a.r - b.r);
    // keep easing the camera to frame the whole graph while it settles, until the user pans or zooms
    let touched = false;
    const fit = () => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x! - n.r);
        y0 = Math.min(y0, n.y! - n.r);
        x1 = Math.max(x1, n.x! + n.r);
        y1 = Math.max(y1, n.y! + n.r);
      }
      const k = Math.min(1.6, Math.max(0.25, Math.min((w - 48) / (x1 - x0), (h - 48) / (y1 - y0))));
      const v = view.current;
      const e = 0.12;
      v.k += (k - v.k) * e;
      v.x += ((-(x0 + x1) / 2) * k - v.x) * e;
      v.y += ((-(y0 + y1) / 2) * k - v.y) * e;
    };

    let raf = 0;
    const draw = () => {
      if (!touched) fit();
      const { selectedId, blastId, blastSet, hover, palette } = state.current;
      const v = view.current;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + v.x, h / 2 + v.y);
      ctx.scale(v.k, v.k);
      const focus = blastId ?? selectedId;
      const lit = (id: string) => !blastId || id === blastId || blastSet.has(id) || id === r.rootId;
      ctx.lineWidth = 0.8 / v.k;
      for (const l of links) {
        const s = l.source as N, t = l.target as N;
        const hot = blastId && (blastSet.has(s.id) || s.id === blastId) && (t.id === blastId || blastSet.has(t.id));
        ctx.strokeStyle = hot ? 'rgba(255,138,31,0.8)' : focus && (s.id === focus || t.id === focus) ? 'rgba(255,255,255,0.55)' : 'rgba(234,223,211,0.09)';
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of order) {
        const alpha = lit(n.id) ? 1 : 0.14;
        ctx.globalAlpha = alpha;
        const c = bodyColour(n.p, palette);
        const vuln = !!n.p?.vulns.length;
        // vulnerable spheres (and the project itself) give off a little light in colour mode
        if ((vuln && palette === 'colour') || !n.p) {
          const halo = ctx.createRadialGradient(n.x!, n.y!, n.r * 0.6, n.x!, n.y!, n.r * 2.6);
          halo.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
          halo.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
        sphere(ctx, n.x!, n.y!, n.r, c);
        if (!n.p) continue;
        // plain mode keeps severity readable as a thin outline
        if (vuln && palette === 'plain') {
          ctx.strokeStyle = SEV_META[n.p.severity].color;
          ctx.lineWidth = 2 / v.k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 1, 0, Math.PI * 2);
          ctx.stroke();
        }
        // maintainer risk ring
        ctx.lineWidth = 1.3 / v.k;
        ctx.lineCap = 'round';
        if (n.p.risk.available) {
          ctx.globalAlpha = alpha * (palette === 'plain' ? 0.35 : 0.8);
          ctx.strokeStyle = palette === 'plain' ? '#eadfd3' : RISK_COLOR(n.p.risk.score);
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 3.5, -Math.PI / 2, -Math.PI / 2 + ((n.p.risk.score ?? 0) / 100) * Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = alpha;
        } else {
          ctx.setLineDash([2 / v.k, 3 / v.k]);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 3.5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (n.id === selectedId || n.id === hover?.id) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / v.k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 7, 0, Math.PI * 2);
          ctx.stroke();
        }
        if ((vuln || n.r > 12 || n.id === selectedId || n.id === hover?.id) && v.k > 0.6) {
          ctx.fillStyle = 'rgba(243,236,228,0.92)';
          ctx.font = `500 ${11 / v.k}px "Geist", sans-serif`;
          ctx.fillText(n.p.name, n.x! + n.r + 6, n.y! + 4 / v.k);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const toWorld = (ev: { clientX: number; clientY: number }) => {
      const rect = c.getBoundingClientRect();
      const v = view.current;
      return { x: (ev.clientX - rect.left - w / 2 - v.x) / v.k, y: (ev.clientY - rect.top - h / 2 - v.y) / v.k };
    };
    const pick = (ev: { clientX: number; clientY: number }) => {
      const p = toWorld(ev);
      let best: N | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        if (d < n.r + 6 && d < bd) (best = n), (bd = d);
      }
      return best;
    };
    let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      touched = true;
      drag = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, moved: false };
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        view.current.x = drag.vx + dx;
        view.current.y = drag.vy + dy;
        return;
      }
      const n = pick(e);
      if (n?.id !== state.current.hover?.id) {
        if (n) sfx.tick(1.4);
        setHover(n);
      }
      c.style.cursor = n ? 'pointer' : 'grab';
    };
    const up = (e: PointerEvent) => {
      if (drag && !drag.moved) {
        const n = pick(e);
        if (n?.p) select(n.id);
      }
      drag = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touched = true;
      const k = Math.min(4, Math.max(0.25, view.current.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      view.current.k = k;
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      sim.stop();
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel);
    };
  }, [nodes, links, r.rootId, select]);

  const choosePalette = (m: Palette) => {
    setPalette(m);
    sfx.pop();
    try {
      localStorage.setItem(PALETTE_KEY, m);
    } catch {
      /* a per-viewer nicety only */
    }
  };

  return (
    <div className="panel-body graph-panel">
      <div className="row between graph-head">
        <p className="fine">Size = how many packages depend on it · ring = maintainer risk (dashed = no data). Drag to pan, scroll to zoom, click to inspect.</p>
        <div className="graph-controls">
          <div className="seg" role="radiogroup" aria-label="Sphere colours">
            {(['colour', 'plain'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={palette === m} className={palette === m ? 'on' : ''} onClick={() => choosePalette(m)}>
                {m === 'colour' ? 'Colourful' : 'Plain'}
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={onlyVuln} onChange={(e) => (setOnlyVuln(e.target.checked), sfx.pop())} />
            <span />
            Vulnerable paths only
          </label>
        </div>
      </div>
      <div className="graph-wrap" ref={wrap}>
        <canvas ref={canvas} />
        {palette === 'colour' && (
          <div className="graph-key" aria-hidden>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const).map((k) => (
              <span key={k}>
                <i style={{ background: SEV_META[k].color }} />
                {SEV_META[k].label}
              </span>
            ))}
            <span>
              <i style={{ background: CLEAN_HEX }} />
              No known advisories
            </span>
          </div>
        )}
        {hover?.p && (
          <div className="graph-tip">
            <b>{hover.p.name}</b> {hover.p.version}
            <br />
            {SEV_META[hover.p.severity].label} · {hover.p.transitiveDependents} dependents
          </div>
        )}
      </div>
    </div>
  );
}
