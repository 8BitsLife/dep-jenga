import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { FixPanel } from './components/FixPanel';
import { GraphView } from './components/GraphView';
import { Dock, IntegrityMeter, Legend, NavRail, Toasts, TopBar } from './components/Hud';
import { Inspector } from './components/Inspector';
import { Intro } from './components/Intro';
import { Landing } from './components/Landing';
import { ErrorCard, Loading } from './components/Loading';
import { Overview } from './components/Overview';
import { SourcesPanel } from './components/SourcesPanel';
import { Experience } from './scene/Experience';
import { useStore, type Panel } from './store';

const PANEL_TITLES: Record<Exclude<Panel, null>, string> = {
  overview: 'Risk dashboard',
  graph: 'Dependency graph',
  fix: 'Remediation plan',
  sources: 'Data sources & method',
};

export default function App() {
  const phase = useStore((s) => s.phase);
  const panel = useStore((s) => s.panel);
  const selectedId = useStore((s) => s.selectedId);
  const shakeAt = useStore((s) => s.shakeAt);
  const flashAt = useStore((s) => s.flashAt);
  const [shaking, setShaking] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  // deep link: ?repo=owner/name
  useEffect(() => {
    const repo = new URLSearchParams(window.location.search).get('repo');
    if (repo) useStore.getState().start(repo);
  }, []);

  useEffect(() => {
    if (!shakeAt) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 650);
    return () => clearTimeout(t);
  }, [shakeAt]);

  useKeyboard();

  return (
    <MotionConfig reducedMotion="user">
    <div className={`app phase-${phase}`}>
      <div className={`stage ${shaking ? 'shake' : ''}`}>
        <Experience />
      </div>
      <div className="nebula" aria-hidden />
      <AnimatePresence>{flashAt > 0 && <motion.div key={flashAt} className="flash" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.9 }} />}</AnimatePresence>

      <AnimatePresence mode="wait">
        {phase === 'landing' && introDone && <Landing key="landing" />}
        {phase === 'loading' && <Loading key="loading" />}
        {phase === 'error' && <ErrorCard key="error" />}
      </AnimatePresence>

      {phase === 'ready' && (
        <>
          <TopBar />
          <NavRail />
          <AnimatePresence>
            {panel && (
              <motion.aside
                key="panel"
                className={`side-panel glass ${panel === 'graph' ? 'wide' : ''}`}
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -40, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              >
                <header className="panel-head">
                  <h2>{PANEL_TITLES[panel]}</h2>
                  <button className="icon-btn" onClick={() => useStore.getState().setPanel(null)}>
                    ✕
                  </button>
                </header>
                {panel === 'overview' && <Overview />}
                {panel === 'graph' && <GraphView />}
                {panel === 'fix' && <FixPanel />}
                {panel === 'sources' && <SourcesPanel />}
              </motion.aside>
            )}
          </AnimatePresence>
          <AnimatePresence>{selectedId && <Inspector key="inspector" />}</AnimatePresence>
          {panel !== 'graph' && <IntegrityMeter />}
          {!selectedId && panel !== 'graph' && <Legend />}
          <Dock />
        </>
      )}
      <Toasts />
      <Intro onReveal={() => setIntroDone(true)} />
    </div>
    </MotionConfig>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      if (s.phase !== 'ready') return;
      const k = e.key.toLowerCase();
      window.dispatchEvent(new CustomEvent('depjenga:key', { detail: k }));
      switch (k) {
        case '1':
        case 'i':
          s.setTool('inspect');
          break;
        case '2':
        case 'p':
          s.setTool('pull');
          break;
        case '3':
        case 'b':
          s.setTool('blast');
          break;
        case 'q':
          s.quake();
          break;
        case 'r':
          s.rebuild();
          break;
        case 'd':
          s.detonate();
          break;
        case 'm':
          s.toggleMute();
          break;
        case 'o':
          s.setPanel('overview');
          break;
        case 'g':
          s.setPanel('graph');
          break;
        case 'f':
          s.setPanel('fix');
          break;
        case 's':
          s.setPanel('sources');
          break;
        case 'escape':
          if (s.blastId) s.showBlast(undefined);
          else if (s.selectedId) s.select(undefined);
          else if (s.panel) s.setPanel(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
