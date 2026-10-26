import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RISK_COLOR, SEV_META } from '../lib/severity';
import { sfx } from '../lib/sound';
import type { PackageNode } from '../lib/types';
import { useStore } from '../store';

interface N extends SimulationNodeDatum {
  id: string;
  p?: PackageNode;
  r: number;
}
type L = SimulationLinkDatum<N>;

/** Force-directed dependency graph on a canvas. Node size = blast radius, ring = bus-factor risk. */
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
  const view = useRef({ x: 0, y: 0, k: 1 });
  const state = useRef({ selectedId, blastId, blastSet, hover: null as N | null });
  state.current = { selectedId, blastId, blastSet, hover };

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
    const nodes: N[] = [{ id: r.rootId, r: 16, fx: 0, fy: 0 }, ...pk.map((p) => ({ id: p.id, p, r: 3.5 + Math.sqrt(p.transitiveDependents) * 1.6 + (p.vulns.length ? 2 : 0) }))];
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
      .force('link', forceLink<N, L>(links).id((d) => d.id).distance((l) => ((l.source as N).id === r.rootId ? 70 : 34)).strength(0.5))
      .force('charge', forceManyBody().strength(-60))
      .force('collide', forceCollide<N>().radius((d) => d.r + 2))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.025);

    let raf = 0;
    const draw = () => {
      const { selectedId, blastId, blastSet, hover } = state.current;
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
        ctx.strokeStyle = hot ? 'rgba(255,138,31,0.8)' : focus && (s.id === focus || t.id === focus) ? 'rgba(255,255,255,0.55)' : 'rgba(155,123,255,0.13)';
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      for (const n of nodes) {
        const alpha = lit(n.id) ? 1 : 0.15;
        ctx.globalAlpha = alpha;
        if (!n.p) {
          ctx.fillStyle = '#9b7bff';
          ctx.shadowColor = '#9b7bff';
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          continue;
        }
        const m = SEV_META[n.p.severity];
        const vuln = n.p.vulns.length > 0;
        ctx.fillStyle = vuln ? m.color : n.p.severity === 'NOT_SCANNED' ? '#3a3a4a' : '#2e3558';
        if (vuln) {
          ctx.shadowColor = m.color;
          ctx.shadowBlur = 16;
        }
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // risk ring
        ctx.lineWidth = 1.6 / v.k;
        if (n.p.risk.available) {
          ctx.strokeStyle = RISK_COLOR(n.p.risk.score);
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 2, -Math.PI / 2, -Math.PI / 2 + ((n.p.risk.score ?? 0) / 100) * Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.setLineDash([2 / v.k, 2 / v.k]);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (n.id === selectedId || n.id === hover?.id) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / v.k;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, n.r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if ((vuln || n.r > 9 || n.id === selectedId || n.id === hover?.id) && v.k > 0.6) {
          ctx.fillStyle = 'rgba(239,234,255,0.9)';
          ctx.font = `${11 / v.k}px "Space Grotesk", sans-serif`;
          ctx.fillText(n.p.name, n.x! + n.r + 4, n.y! + 4 / v.k);
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

  return (
    <div className="panel-body graph-panel">
      <div className="row between">
        <p className="fine">Node size = how many packages depend on it · outer ring = bus-factor risk (dashed = no data). Drag to pan, scroll to zoom, click to inspect.</p>
        <label className="toggle">
          <input type="checkbox" checked={onlyVuln} onChange={(e) => (setOnlyVuln(e.target.checked), sfx.pop())} />
          <span />
          Vulnerable paths only
        </label>
      </div>
      <div className="graph-wrap" ref={wrap}>
        <canvas ref={canvas} />
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
