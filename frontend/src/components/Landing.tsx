import { motion } from 'framer-motion';
import { useState } from 'react';
import { sfx } from '../lib/sound';
import { useStore } from '../store';

const EXAMPLES = [
  { repo: 'expressjs/express', tag: 'npm' },
  { repo: 'juice-shop/juice-shop', tag: 'npm · intentionally vulnerable' },
  { repo: 'gin-gonic/gin', tag: 'Go' },
  { repo: 'pallets/flask', tag: 'PyPI' },
  { repo: 'BurntSushi/ripgrep', tag: 'Rust' },
  { repo: 'rails/rails', tag: 'RubyGems' },
];

const TITLE = 'DEPJENGA';

export function Landing() {
  const start = useStore((s) => s.start);
  const [value, setValue] = useState('');
  const [shake, setShake] = useState(0);

  const submit = (repo = value) => {
    if (!repo.trim()) {
      setShake((s) => s + 1);
      sfx.error();
      return;
    }
    sfx.whoosh();
    start(repo.trim());
  };

  return (
    <motion.section className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20, filter: 'blur(8px)' }} transition={{ duration: 0.5 }}>
      <div className="landing-inner">
        <motion.div className="eyebrow" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <span className="pulse-dot" /> Hacktoberfest build · dependency security, as a game
        </motion.div>
        <h1 className="title" aria-label={TITLE}>
          {TITLE.split('').map((ch, i) => (
            <motion.span
              key={i}
              className="title-ch"
              initial={{ y: -80, opacity: 0, rotate: (i % 2 ? 1 : -1) * 12 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.15 + i * 0.045 }}
              whileHover={{ y: -8, rotate: (i % 2 ? 1 : -1) * 8, transition: { type: 'spring', stiffness: 500, damping: 8 } }}
              onHoverStart={() => sfx.tick(0.8 + i * 0.06)}
            >
              {ch}
            </motion.span>
          ))}
        </h1>
        <motion.p className="tagline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
          Your dependency tree is a Jenga tower. Paste a GitHub repo and we stack every package as a block —
          <em> glowing</em> by real CVE severity, <em>thinner</em> when its maintainers are a bus factor away from vanishing.
          Then pull blocks and watch what falls.
        </motion.p>

        <motion.form
          key={shake}
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          initial={shake ? { x: 0 } : { opacity: 0, y: 20 }}
          animate={shake ? { x: [0, -12, 10, -8, 6, 0] } : { opacity: 1, y: 0 }}
          transition={shake ? { duration: 0.4 } : { delay: 0.85, type: 'spring', stiffness: 200, damping: 18 }}
        >
          <span className="search-icon">⌁</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              sfx.tick(1.5 + Math.random() * 0.3);
            }}
            placeholder="github.com/owner/repo"
            spellCheck={false}
            aria-label="GitHub repository URL"
          />
          <button type="submit" className="cta">
            <span>Build my tower</span>
            <span className="cta-arrow">→</span>
          </button>
        </motion.form>

        <motion.div className="examples" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05 }}>
          <span className="examples-label">Try</span>
          {EXAMPLES.map((ex, i) => (
            <motion.button
              key={ex.repo}
              type="button"
              className="chip"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.1 + i * 0.05 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.94 }}
              onHoverStart={() => sfx.tick(1.2)}
              onClick={() => {
                setValue(ex.repo);
                submit(ex.repo);
              }}
            >
              {ex.repo}
              <small>{ex.tag}</small>
            </motion.button>
          ))}
        </motion.div>

        <motion.div className="landing-foot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
          <div className="foot-sources">
            Real data only: <b>OSV.dev</b> · <b>GitHub Advisory Database</b> · <b>deps.dev</b> · <b>OpenSSF Scorecard</b> · <b>npm registry</b>
          </div>
          <div className="foot-honesty">
            <span className="hatch-swatch" /> Hatched = data unavailable. Nothing is estimated, nothing is invented.
          </div>
        </motion.div>
      </div>
      <div className="landing-hint">click the tower blocks · they're not shy</div>
    </motion.section>
  );
}
