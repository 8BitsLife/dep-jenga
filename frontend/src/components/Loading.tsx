import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { sfx } from '../lib/sound';
import { useStore } from '../store';

/** The backend's fine-grained stages, grouped into the six steps a person cares about. */
const STEPS: { title: string; stages: string[] }[] = [
  { title: 'Finding the repository', stages: ['repo', 'tree'] },
  { title: 'Reading dependency files', stages: ['manifests', 'parse'] },
  { title: 'Mapping the dependency tree', stages: ['resolve', 'expand', 'graph'] },
  { title: 'Checking for known vulnerabilities', stages: ['osv', 'ghsa'] },
  { title: 'Measuring maintainer health', stages: ['risk'] },
  { title: 'Working out fixes', stages: ['remediate', 'done'] },
];

const BLOCKS = 12; // four layers of three, like a tiny Jenga tower

function stepFor(stage: string | undefined) {
  const i = STEPS.findIndex((s) => stage && s.stages.includes(stage));
  return i < 0 ? 0 : i;
}

/** "Measuring bus factor (48/193)" -> { text: "Measuring bus factor", count: "48 of 193" } */
function splitCount(message: string) {
  const m = message.match(/^(.*?)\s*\((\d+)\/(\d+)\)\s*$/);
  return m ? { text: m[1], count: `${m[2]} of ${m[3]}` } : { text: message, count: null };
}

export function Loading() {
  const progress = useStore((s) => s.progress);
  const pct = useStore((s) => s.pct);
  const repo = useStore((s) => s.repoInput);
  const home = useStore((s) => s.home);

  const latest = progress[progress.length - 1];
  const step = stepFor(latest?.stage);
  const detail = latest ? splitCount(latest.message) : { text: 'Connecting to the analysis engine', count: null };
  const placed = Math.round((pct / 100) * BLOCKS);

  // a soft wooden knock as each block lands, rising in pitch as the tower grows
  const lastPlaced = useRef(0);
  useEffect(() => {
    if (placed > lastPlaced.current) sfx.tock(0.85 + placed * 0.03, 0.4);
    lastPlaced.current = placed;
  }, [placed]);

  return (
    <motion.section
      className="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      aria-live="polite"
    >
      <motion.div
        className="loader glass"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="loader-main">
          <div className="loader-tower" aria-hidden>
            {Array.from({ length: BLOCKS }).map((_, i) => {
              const layer = Math.floor(i / 3);
              const lengthwise = layer % 2 === 1; // odd layers show one long face, even layers three block ends
              if (lengthwise && i % 3 !== 0) return null;
              return (
                <AnimatePresence key={i}>
                  {i < placed && (
                    <motion.span
                      className={`loader-block ${lengthwise ? 'long' : ''} ${i === placed - 1 || (lengthwise && placed - 1 < i + 3 && placed - 1 >= i) ? 'newest' : ''}`}
                      style={{ bottom: layer * 13, left: lengthwise ? 0 : (i % 3) * 18 }}
                      initial={{ y: -36, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                    />
                  )}
                </AnimatePresence>
              );
            })}
          </div>

          <div className="loader-text">
            <div className="loader-repo">{repo}</div>
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={step}
                className="loader-title"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {STEPS[step].title}
              </motion.h2>
            </AnimatePresence>
            <p className="loader-detail">
              <span>{detail.text}</span>
              {detail.count && <span className="loader-count">{detail.count}</span>}
            </p>
          </div>
        </div>

        <div className="loader-progress">
          <div className="loader-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <motion.span animate={{ width: `${Math.max(pct, 2)}%` }} transition={{ type: 'spring', stiffness: 70, damping: 20 }} />
          </div>
          <div className="loader-meta">
            <span>
              Step {step + 1} of {STEPS.length}
            </span>
            <span>{pct}%</span>
          </div>
        </div>

        <button className="loader-cancel" onClick={home}>
          Cancel
        </button>
      </motion.div>
    </motion.section>
  );
}

export function ErrorCard() {
  const error = useStore((s) => s.error);
  const repo = useStore((s) => s.repoInput);
  const start = useStore((s) => s.start);
  const home = useStore((s) => s.home);
  return (
    <motion.section className="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="loader glass error-card"
        role="alert"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <span className="error-block" aria-hidden />
        <h2>The tower couldn't be built</h2>
        <p>{error}</p>
        <div className="row gap">
          <button className="key key-primary" onClick={() => start(repo, true)}>
            Try again
          </button>
          <button className="key key-ghost" onClick={home}>
            Use another repository
          </button>
        </div>
      </motion.div>
    </motion.section>
  );
}
