import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { RISK_COLOR, SEV_META } from '../lib/severity';
import { useStore, type Panel, type Tool } from '../store';
import { Key, Ring } from './ui';

export function TopBar() {
  const r = useStore((s) => s.result)!;
  const home = useStore((s) => s.home);
  const start = useStore((s) => s.start);
  const s = r.summary;
  const gradeColor = s.overallScore >= 70 ? '#ff2e63' : s.overallScore >= 50 ? '#ff8a1f' : s.overallScore >= 30 ? '#ffd23f' : '#4dffb5';
  return (
    <motion.header className="topbar" initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 20 }}>
      <button className="brand" onClick={home} title="New scan">
        <span className="brand-mark">
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">DEPJENGA</span>
      </button>
      <div className="repo-pill glass">
        <a href={r.repo.url} target="_blank" rel="noreferrer" className="repo-name">
          {r.repo.fullName}
        </a>
        <span className="repo-meta">
          {r.repo.ref && <span>⎇ {r.repo.ref}</span>}
          {r.repo.stars != null ? <span>★ {r.repo.stars.toLocaleString()}</span> : <span className="unavailable">★ n/a</span>}
          {r.repo.archived && <span className="warn">archived</span>}
        </span>
        <button className="icon-btn" title="Re-scan, bypassing the cache" onClick={() => start(r.repo.fullName, true)}>
          ↻
        </button>
      </div>
      <div className="grade-pill glass" title={s.scoreExplanation.join('\n')}>
        <Ring value={s.overallScore} size={46} stroke={5} color={gradeColor} label={<span style={{ color: gradeColor }}>{s.grade}</span>} />
        <div>
          <div className="grade-label">Collapse risk</div>
          <div className="grade-score">
            <b style={{ color: gradeColor }}>{s.overallScore}</b>/100
          </div>
        </div>
      </div>
    </motion.header>
  );
}

const TOOLS: { id: Tool; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'inspect', label: 'Inspect', icon: '◎', key: '1', hint: 'Click a block to inspect its package' },
  { id: 'pull', label: 'Pull', icon: '✋', key: '2', hint: 'Press & hold a block to yank it out of the tower' },
  { id: 'blast', label: 'Blast radius', icon: '✺', key: '3', hint: 'Click a block to see everything that depends on it' },
];

export function Dock() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const quake = useStore((s) => s.quake);
  const rebuild = useStore((s) => s.rebuild);
  const detonate = useStore((s) => s.detonate);
  const blastId = useStore((s) => s.blastId);
  const muted = useStore((s) => s.muted);
  const toggleMute = useStore((s) => s.toggleMute);
  const awake = useStore((s) => s.awake);
  const hint = TOOLS.find((t) => t.id === tool)!.hint;
  return (
    <motion.div className="dock-wrap" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 20, delay: 0.15 }}>
      <AnimatePresence mode="wait">
        <motion.div key={tool + (blastId ?? '')} className="dock-hint" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
          {tool === 'blast' && blastId ? 'Press D to detonate the blast radius — or pick another block' : hint}
        </motion.div>
      </AnimatePresence>
      <div className="dock glass">
        {TOOLS.map((t, i) => (
          <Key key={t.id} active={tool === t.id} hotkey={t.key} onClick={() => setTool(t.id)} pitch={1 + i * 0.15} title={t.hint}>
            <span className="key-icon">{t.icon}</span>
            <span className="key-label">{t.label}</span>
          </Key>
        ))}
        <span className="dock-sep" />
        <AnimatePresence>
          {blastId && (
            <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} style={{ display: 'flex' }}>
              <Key tone="danger" hotkey="D" onClick={detonate} title="Blow up this package and everything that depends on it">
                <span className="key-icon">💥</span>
                <span className="key-label">Detonate</span>
              </Key>
            </motion.div>
          )}
        </AnimatePresence>
        <Key hotkey="Q" onClick={quake} title="Shake the table" pitch={0.7}>
          <span className="key-icon">〰</span>
          <span className="key-label">Quake</span>
        </Key>
        <Key hotkey="R" onClick={rebuild} title="Restack the tower" pitch={0.85} active={false}>
          <span className="key-icon">⟲</span>
          <span className="key-label">{awake ? 'Rebuild' : 'Restack'}</span>
        </Key>
        <Key hotkey="M" onClick={toggleMute} title={muted ? 'Sound off' : 'Sound on'} tone="ghost">
          <span className="key-icon">{muted ? '🔇' : '🔊'}</span>
        </Key>
      </div>
    </motion.div>
  );
}

const NAV: { id: Exclude<Panel, null>; icon: string; label: string; key: string }[] = [
  { id: 'overview', icon: '▦', label: 'Risk dashboard', key: 'O' },
  { id: 'graph', icon: '⌬', label: 'Dependency graph', key: 'G' },
  { id: 'fix', icon: '✚', label: 'Remediation', key: 'F' },
  { id: 'sources', icon: 'ⓘ', label: 'Data sources & method', key: 'S' },
];

export function NavRail() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const fixable = useStore((s) => s.result?.summary.fixable ?? 0);
  return (
    <motion.nav className="rail glass" initial={{ x: -60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 20, delay: 0.1 }}>
      {NAV.map((n) => (
        <button key={n.id} className={`rail-btn ${panel === n.id ? 'on' : ''}`} onClick={() => setPanel(n.id)} title={`${n.label} (${n.key})`}>
          <span>{n.icon}</span>
          {n.id === 'fix' && fixable > 0 && <i className="rail-badge">{fixable}</i>}
          <em className="rail-tip">{n.label}</em>
        </button>
      ))}
    </motion.nav>
  );
}

export function Legend() {
  const [open, setOpen] = useState(window.innerWidth > 900);
  const counts = useStore((s) => s.result?.summary.severityCounts) ?? {};
  const omitted = useStore((s) => s.omitted);
  const blocks = useStore((s) => s.blocks.length);
  return (
    <motion.div className={`legend glass ${open ? 'open' : ''}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
      <button className="legend-toggle" onClick={() => setOpen(!open)}>
        Legend {open ? '−' : '+'}
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-title">Color = worst known advisory</div>
          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'NONE'] as const).map((s) => (
            <div key={s} className="legend-row">
              <span className="legend-swatch" style={{ background: SEV_META[s].color, boxShadow: SEV_META[s].glow ? `0 0 10px ${SEV_META[s].color}` : undefined }} />
              {SEV_META[s].label}
              <b>{counts[s] ?? 0}</b>
            </div>
          ))}
          <div className="legend-title">Width = bus-factor risk</div>
          <div className="legend-widths">
            {[0, 30, 60, 90].map((r) => (
              <span key={r} style={{ width: 46 * (1 - (r / 100) * 0.5), background: RISK_COLOR(r) }} title={`risk ${r}`} />
            ))}
            <small>healthy → fragile</small>
          </div>
          <div className="legend-row">
            <span className="legend-swatch hatch" /> Hatched = data unavailable
          </div>
          <div className="legend-foot">Bottom blocks = most depended-upon packages.{omitted > 0 && ` Showing ${blocks} blocks; ${omitted} lower-priority packages appear only in the dashboards & graph.`}</div>
        </div>
      )}
    </motion.div>
  );
}

export function IntegrityMeter() {
  const awake = useStore((s) => s.awake);
  const integrity = useStore((s) => s.integrity);
  const pct = Math.round(integrity * 100);
  const color = pct > 85 ? '#4dffb5' : pct > 55 ? '#ffd23f' : '#ff2e63';
  return (
    <AnimatePresence>
      {awake && (
        <motion.div className="integrity glass" initial={{ opacity: 0, scale: 0.8, y: -10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }}>
          <div className="integrity-label">Tower integrity</div>
          <div className="integrity-value" style={{ color }}>
            {pct}%
          </div>
          <div className="integrity-bar">
            <motion.span animate={{ width: `${pct}%`, background: color }} transition={{ type: 'spring', stiffness: 120, damping: 18 }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast toast-${t.tone}`}
            initial={{ opacity: 0, y: -24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
