import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store';

const STAGES = [
  { key: 'repo', label: 'Repo' },
  { key: 'manifests', label: 'Manifests' },
  { key: 'expand', label: 'Tree' },
  { key: 'osv', label: 'OSV' },
  { key: 'ghsa', label: 'GHSA' },
  { key: 'risk', label: 'Bus factor' },
  { key: 'done', label: 'Stack' },
];
const STAGE_PCT: Record<string, number> = { repo: 0, tree: 4, manifests: 8, parse: 12, resolve: 18, expand: 24, graph: 32, osv: 36, ghsa: 55, risk: 64, remediate: 92, done: 100 };

export function Loading() {
  const progress = useStore((s) => s.progress);
  const pct = useStore((s) => s.pct);
  const repo = useStore((s) => s.repoInput);
  const home = useStore((s) => s.home);
  const blocks = Math.round((pct / 100) * 15);
  const lastStage = progress[progress.length - 1]?.stage ?? 'repo';

  return (
    <motion.section className="loading" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}>
      <div className="loading-card glass">
        <div className="loading-top">
          <div className="mini-tower" aria-hidden>
            {Array.from({ length: 15 }).map((_, i) => {
              const layer = Math.floor(i / 3);
              return (
                <AnimatePresence key={i}>
                  {i < blocks && (
                    <motion.span
                      className={`mini-block ${layer % 2 ? 'odd' : ''}`}
                      style={{ bottom: layer * 14, left: layer % 2 ? 0 : (i % 3) * 22 }}
                      initial={{ y: -60, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    />
                  )}
                </AnimatePresence>
              );
            })}
          </div>
          <div>
            <div className="loading-repo">{repo}</div>
            <div className="loading-pct">
              {pct}
              <span>%</span>
            </div>
          </div>
        </div>
        <div className="stage-row">
          {STAGES.map((s) => {
            const reached = (STAGE_PCT[lastStage] ?? 0) >= (STAGE_PCT[s.key] ?? 0) && progress.length > 0;
            return (
              <span key={s.key} className={`stage-chip ${reached ? 'on' : ''}`}>
                {s.label}
              </span>
            );
          })}
        </div>
        <div className="bar">
          <motion.div className="bar-fill" animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 60, damping: 18 }} />
        </div>
        <div className="log">
          <AnimatePresence initial={false}>
            {progress.slice(-6).map((p, i, arr) => (
              <motion.div key={`${p.message}-${p.pct}`} className={`log-line ${i === arr.length - 1 ? 'current' : ''}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <span className="log-caret">{i === arr.length - 1 ? '▸' : '✓'}</span> {p.message}
              </motion.div>
            ))}
          </AnimatePresence>
          {progress.length === 0 && <div className="log-line current">▸ Connecting to the analysis engine…</div>}
        </div>
        <button className="link-btn" onClick={home}>
          Cancel
        </button>
      </div>
    </motion.section>
  );
}

export function ErrorCard() {
  const error = useStore((s) => s.error);
  const repo = useStore((s) => s.repoInput);
  const start = useStore((s) => s.start);
  const home = useStore((s) => s.home);
  return (
    <motion.section className="loading" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="loading-card glass error-card">
        <div className="error-glyph">⚠</div>
        <h2>The tower couldn't be built</h2>
        <p>{error}</p>
        <div className="row gap">
          <button className="key key-primary" onClick={() => start(repo, true)}>
            Retry
          </button>
          <button className="key key-ghost" onClick={home}>
            Try another repo
          </button>
        </div>
      </div>
    </motion.section>
  );
}
