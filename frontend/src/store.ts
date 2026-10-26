import { create } from 'zustand';
import { analyzeRepo } from './lib/api';
import { blastRadius, indexGraph, type GraphIndex } from './lib/graph';
import * as physics from './lib/physics';
import { sfx } from './lib/sound';
import { layoutTower, type BlockSpec } from './lib/tower';
import type { AnalysisResult, ProgressEvent } from './lib/types';

export type Phase = 'landing' | 'loading' | 'ready' | 'error';
export type Tool = 'inspect' | 'pull' | 'blast';
export type Panel = 'overview' | 'graph' | 'fix' | 'sources' | null;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'danger' | 'success';
}

interface State {
  phase: Phase;
  repoInput: string;
  progress: ProgressEvent[];
  pct: number;
  error?: string;
  result?: AnalysisResult;
  graph?: GraphIndex;
  blocks: BlockSpec[];
  omitted: number;
  selectedId?: string;
  hoverId?: string;
  tool: Tool;
  blastId?: string;
  blastSet: Set<string>;
  panel: Panel;
  muted: boolean;
  towerKey: number;
  awake: boolean;
  quakeUntil: number;
  integrity: number;
  collapsedOnce: boolean;
  shakeAt: number;
  flashAt: number;
  toasts: Toast[];
  cancel?: () => void;

  start: (repo: string, fresh?: boolean) => void;
  home: () => void;
  select: (id?: string) => void;
  hover: (id?: string) => void;
  setTool: (t: Tool) => void;
  showBlast: (id?: string) => void;
  setPanel: (p: Panel) => void;
  toggleMute: () => void;
  rebuild: () => void;
  pull: (id: string) => void;
  quake: () => void;
  detonate: () => void;
  setIntegrity: (v: number) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  phase: 'landing',
  repoInput: '',
  progress: [],
  pct: 0,
  blocks: [],
  omitted: 0,
  tool: 'inspect',
  blastSet: new Set(),
  panel: null,
  muted: sfx.isMuted(),
  towerKey: 0,
  awake: false,
  quakeUntil: 0,
  integrity: 1,
  collapsedOnce: false,
  shakeAt: 0,
  flashAt: 0,
  toasts: [],

  start(repo, fresh = false) {
    get().cancel?.();
    set({ phase: 'loading', repoInput: repo, progress: [], pct: 0, error: undefined, selectedId: undefined, blastId: undefined, blastSet: new Set(), panel: null });
    const cancel = analyzeRepo(repo, fresh, {
      onProgress: (e) => set((s) => ({ progress: [...s.progress.slice(-40), e], pct: Math.max(s.pct, e.pct) })),
      onResult: (r) => {
        physics.bodies.clear();
        physics.specs.clear();
        const { blocks, omitted } = layoutTower(r.packages);
        set((s) => ({
          phase: 'ready',
          result: r,
          graph: indexGraph(r),
          blocks,
          omitted,
          pct: 100,
          towerKey: s.towerKey + 1,
          awake: false,
          integrity: 1,
          collapsedOnce: false,
          tool: 'inspect',
          panel: window.innerWidth > 900 ? 'overview' : null,
        }));
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('repo', r.repo.fullName);
          window.history.replaceState(null, '', url);
        } catch {
          /* ignore */
        }
        setTimeout(() => sfx.chime(), 900);
        const v = r.summary.vulnerablePackages;
        get().toast(
          `Tower built: ${blocks.length} blocks · ${v === 0 ? 'no known vulnerable versions' : `${v} vulnerable package${v === 1 ? '' : 's'}`}`,
          v ? 'danger' : 'success',
        );
      },
      onError: (message) => {
        sfx.error();
        set({ phase: 'error', error: message });
      },
    });
    set({ cancel });
  },

  home() {
    get().cancel?.();
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('repo');
      window.history.replaceState(null, '', url);
    } catch {
      /* ignore */
    }
    physics.bodies.clear();
    physics.specs.clear();
    set((s) => ({ phase: 'landing', result: undefined, graph: undefined, blocks: [], selectedId: undefined, blastId: undefined, blastSet: new Set(), panel: null, towerKey: s.towerKey + 1, awake: false }));
  },

  select(id) {
    if (id && id !== get().selectedId) sfx.tock(1.1);
    set({ selectedId: id });
  },

  hover(id) {
    if (id && id !== get().hoverId) sfx.tick(1 + Math.random() * 0.2);
    set({ hoverId: id });
  },

  setTool(t) {
    sfx.pop(t === 'inspect' ? 1 : t === 'pull' ? 1.15 : 1.3);
    set({ tool: t });
  },

  showBlast(id) {
    const g = get().graph;
    if (!id || !g) {
      set({ blastId: undefined, blastSet: new Set() });
      return;
    }
    const blast = blastRadius(g, id);
    sfx.whoosh();
    set({ blastId: id, blastSet: blast, selectedId: id });
    const p = g.byId.get(id);
    get().toast(
      blast.size === 0
        ? `${p?.name} is a leaf: nothing else in the tree depends on it (your project uses it directly)`
        : `Blast radius of ${p?.name}: ${blast.size} package${blast.size === 1 ? '' : 's'} depend on it`,
      blast.size > 10 ? 'danger' : 'info',
    );
  },

  setPanel(p) {
    sfx.pop(0.9);
    set((s) => ({ panel: s.panel === p ? null : p }));
  },

  toggleMute() {
    const m = !get().muted;
    sfx.setMuted(m);
    set({ muted: m });
    if (!m) sfx.pop();
  },

  rebuild() {
    physics.bodies.clear();
    sfx.pop(0.8);
    set((s) => ({ towerKey: s.towerKey + 1, awake: false, integrity: 1, collapsedOnce: false, quakeUntil: 0 }));
  },

  pull(id) {
    const p = get().graph?.byId.get(id);
    physics.pull(id);
    sfx.whoosh();
    set({ awake: true, shakeAt: performance.now() });
    if (p) {
      get().toast(
        p.transitiveDependents
          ? `Pulled ${p.name} — ${p.transitiveDependents} package${p.transitiveDependents === 1 ? '' : 's'} were resting on it`
          : `Pulled ${p.name}`,
        p.vulns.length ? 'danger' : 'info',
      );
    }
  },

  quake() {
    physics.wakeAll();
    sfx.rumble(3);
    set({ awake: true, quakeUntil: performance.now() + 3200, shakeAt: performance.now() });
  },

  detonate() {
    const { blastId, blastSet } = get();
    if (!blastId) return;
    physics.detonate(blastId, blastSet);
    sfx.rumble(1.6);
    set({ awake: true, shakeAt: performance.now(), flashAt: performance.now() });
  },

  setIntegrity(v) {
    const s = get();
    if (Math.abs(v - s.integrity) < 0.005) return;
    set({ integrity: v });
    if (v < 0.55 && !s.collapsedOnce) {
      set({ collapsedOnce: true, shakeAt: performance.now() });
      sfx.rumble(1.2);
      get().toast('TOWER COLLAPSE — this is what a bad dependency day looks like', 'danger');
    }
  },

  toast(text, tone = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
  },
}));

if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;
