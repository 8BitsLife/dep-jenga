import { motion, type Variants } from 'framer-motion';
import { useState } from 'react';
import { sfx } from '../lib/sound';
import { useStore } from '../store';

const EXAMPLES = [
  { repo: 'expressjs/express', eco: 'npm' },
  { repo: 'juice-shop/juice-shop', eco: 'npm' },
  { repo: 'gin-gonic/gin', eco: 'Go' },
  { repo: 'pallets/flask', eco: 'PyPI' },
  { repo: 'BurntSushi/ripgrep', eco: 'Rust' },
  { repo: 'rails/rails', eco: 'Ruby' },
];

const REPO_URL = 'https://github.com/8BitsLife/dep-jenga';

// one orchestrated entrance: each piece of the hero settles in order, like stacking
const stack: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};
const piece: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

export function Landing() {
  const start = useStore((s) => s.start);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (repo = value) => {
    const r = repo.trim();
    if (!r) {
      setError('Paste a repository first, like expressjs/express');
      sfx.error();
      return;
    }
    setError(null);
    sfx.pop(0.9);
    start(r);
  };

  return (
    <motion.section className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <header className="land-nav">
        <a className="land-brand" href="/" aria-label="DepJenga home">
          <img src="/logo-192.png" alt="" width={36} height={36} />
          <span>DepJenga</span>
        </a>
        <a className="land-link" href={REPO_URL} target="_blank" rel="noreferrer">
          Source on GitHub <span aria-hidden>↗</span>
        </a>
      </header>

      <motion.div className="land-main" variants={stack} initial="hidden" animate="show">
        <motion.p className="kicker" variants={piece}>
          <span className="kicker-block" aria-hidden />
          Dependency security, built for Hacktoberfest
        </motion.p>

        <motion.h1 className="headline" variants={piece}>
          See which dependency would topple your project.
        </motion.h1>

        <motion.p className="lede" variants={piece}>
          Paste a GitHub repository. Every package it depends on becomes a block in a tower: red where there's a known
          vulnerability, thinner where a package rests on too few maintainers. Pull one out and see what comes down with it.
        </motion.p>

        <motion.form
          className={`search ${error ? 'has-error' : ''}`}
          variants={piece}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="repo" className="sr-only">
            GitHub repository
          </label>
          <span className="search-prefix" aria-hidden>
            github.com/
          </span>
          <input
            id="repo"
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value.replace(/^(https?:\/\/)?(www\.)?github\.com\//, ''));
              if (error) setError(null);
            }}
            placeholder="owner/repo"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? 'repo-error' : undefined}
          />
          <button type="submit" className="build-btn">
            Build tower
          </button>
        </motion.form>
        {error && (
          <p id="repo-error" className="field-error" role="alert">
            {error}
          </p>
        )}

        <motion.div className="examples" variants={piece}>
          <span className="examples-label">Or try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.repo}
              type="button"
              className="example"
              onPointerEnter={() => sfx.tick(1.2)}
              onClick={() => {
                setValue(ex.repo);
                submit(ex.repo);
              }}
            >
              <span className="example-repo">{ex.repo}</span>
              <span className="example-eco">{ex.eco}</span>
            </button>
          ))}
        </motion.div>
      </motion.div>

      <motion.aside
        className="key-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, type: 'spring', stiffness: 200, damping: 24 }}
      >
        <h2>Reading the tower</h2>
        <ul>
          <li>
            <span className="key-swatch red" /> Known vulnerability, colored by severity
          </li>
          <li>
            <span className="key-swatch cream" /> No known advisories
          </li>
          <li>
            <span className="key-swatch thin" /> Thinner: fewer maintainers or stale releases
          </li>
          <li>
            <span className="key-swatch striped" /> Striped: data isn't available
          </li>
        </ul>
        <p>The packages everything else relies on sit at the bottom.</p>
      </motion.aside>

      <footer className="land-foot">
        Vulnerabilities from OSV.dev and the GitHub Advisory Database. Maintainer data from deps.dev, OpenSSF Scorecard and npm.
        Gaps are marked, never guessed.
      </footer>
    </motion.section>
  );
}
