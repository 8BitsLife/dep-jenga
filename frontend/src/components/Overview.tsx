import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { threatOrder } from '../lib/graph';
import { RISK_COLOR, SEV_META, SEV_ORDER } from '../lib/severity';
import { useStore } from '../store';
import { CountUp, Ring, RiskBar, SevChip, ecoIcon } from './ui';

export function Overview() {
  const r = useStore((s) => s.result)!;
  const select = useStore((s) => s.select);
  const s = r.summary;
  const [why, setWhy] = useState(false);
  const gradeColor = s.overallScore >= 70 ? '#ff2e63' : s.overallScore >= 50 ? '#ff8a1f' : s.overallScore >= 30 ? '#ffd23f' : '#4dffb5';

  const threats = useMemo(() => r.packages.filter((p) => p.vulns.length).sort(threatOrder).slice(0, 8), [r]);
  const hotspots = useMemo(() => r.packages.filter((p) => p.risk.available).sort((a, b) => (b.risk.score ?? 0) - (a.risk.score ?? 0) || b.transitiveDependents - a.transitiveDependents).slice(0, 6), [r]);
  const hist = useMemo(() => {
    const bins = Array(10).fill(0);
    r.packages.forEach((p) => {
      if (p.risk.available) bins[Math.min(9, Math.floor((p.risk.score ?? 0) / 10))]++;
    });
    return bins;
  }, [r]);
  const maxBin = Math.max(1, ...hist);
  const sevTotal = SEV_ORDER.reduce((a, k) => a + (s.severityCounts[k] ?? 0), 0) || 1;

  return (
    <div className="panel-body">
      <div className="hero-score">
        <Ring value={s.overallScore} size={132} stroke={11} color={gradeColor} label={<span style={{ color: gradeColor }}>{s.grade}</span>} sub={`${s.overallScore}/100 collapse risk`} />
        <div className="hero-score-text">
          <h3>{r.repo.fullName}</h3>
          {r.repo.description ? <p>{r.repo.description}</p> : <p className="unavailable">No description available</p>}
          <button className="link-btn" onClick={() => setWhy(!why)}>
            {why ? 'Hide' : 'How is this calculated?'}
          </button>
        </div>
      </div>
      {why && (
        <motion.ul className="explain" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          {s.scoreExplanation.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </motion.ul>
      )}

      <div className="tiles">
        <Tile label="Packages" value={s.totalPackages} sub={`${s.direct} direct · ${s.transitive} transitive`} />
        <Tile label="Vulnerable" value={s.vulnerablePackages} sub={`${s.uniqueAdvisories} unique advisories`} tone={s.vulnerablePackages ? 'danger' : 'good'} />
        <Tile label="Fixable" value={s.fixable} sub={s.unfixable ? `${s.unfixable} with no published fix` : 'all have a fix'} tone="good" />
        <Tile label="Fragile" value={s.highBusRisk} sub={`bus-factor risk ≥ 45 (${s.riskAvailable} with data)`} tone={s.highBusRisk ? 'warn' : undefined} />
      </div>

      <h4 className="panel-h">Severity mix (packages)</h4>
      <div className="stack-bar">
        {SEV_ORDER.map((k) => {
          const c = s.severityCounts[k] ?? 0;
          if (!c) return null;
          return (
            <motion.span
              key={k}
              title={`${SEV_META[k].label}: ${c}`}
              className={k === 'NOT_SCANNED' ? 'hatched' : ''}
              style={{ background: k === 'NOT_SCANNED' ? undefined : SEV_META[k].color, boxShadow: SEV_META[k].glow ? `0 0 12px ${SEV_META[k].color}` : undefined }}
              initial={{ flexGrow: 0 }}
              animate={{ flexGrow: c / sevTotal }}
              transition={{ type: 'spring', stiffness: 60, damping: 14 }}
            />
          );
        })}
      </div>
      <div className="row wrap gap-sm">
        {SEV_ORDER.filter((k) => (s.severityCounts[k] ?? 0) > 0).map((k) => (
          <SevChip key={k} severity={k} count={s.severityCounts[k]} small />
        ))}
      </div>

      <h4 className="panel-h">Top threats</h4>
      {threats.length === 0 ? (
        <div className="empty ok">No package version in this tree matches a known advisory in OSV. 🎉</div>
      ) : (
        <div className="list">
          {threats.map((p, i) => (
            <motion.button key={p.id} className="list-row" onClick={() => select(p.id)} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} style={{ ['--sev' as string]: SEV_META[p.severity].color }}>
              <span className="list-dot" />
              <span className="list-main">
                <b>{p.name}</b> <small>{p.version}</small>
                <em>{p.vulns.length} advisor{p.vulns.length === 1 ? 'y' : 'ies'} · blast radius {p.transitiveDependents}</em>
              </span>
              <span className="list-side">{p.maxCvss != null ? p.maxCvss.toFixed(1) : SEV_META[p.severity].short}</span>
            </motion.button>
          ))}
        </div>
      )}

      <h4 className="panel-h">Bus-factor distribution</h4>
      {s.riskAvailable === 0 ? (
        <div className="empty hatched">No maintainer data was available for any package.</div>
      ) : (
        <>
          <div className="hist">
            {hist.map((c, i) => (
              <div key={i} className="hist-col" title={`risk ${i * 10}–${i * 10 + 9}: ${c}`}>
                <motion.span initial={{ height: 0 }} animate={{ height: `${(c / maxBin) * 100}%` }} transition={{ delay: i * 0.03, type: 'spring', stiffness: 90, damping: 14 }} style={{ background: RISK_COLOR(i * 10 + 5) }} />
              </div>
            ))}
          </div>
          <div className="hist-axis">
            <span>healthy</span>
            <span>avg {s.avgBusRisk}</span>
            <span>fragile</span>
          </div>
          <h4 className="panel-h">Fragile foundations</h4>
          <div className="list">
            {hotspots.map((p) => (
              <button key={p.id} className="list-row" onClick={() => select(p.id)} style={{ ['--sev' as string]: RISK_COLOR(p.risk.score) }}>
                <span className="list-dot" />
                <span className="list-main">
                  <b>{p.name}</b>
                  <em>
                    {p.risk.factors
                      .filter((f) => f.points > 0)
                      .slice(0, 2)
                      .map((f) => `${f.name}: ${f.value}`)
                      .join(' · ') || 'no risk factors triggered'}
                  </em>
                </span>
                <RiskBar score={p.risk.score} />
              </button>
            ))}
          </div>
        </>
      )}

      <h4 className="panel-h">Ecosystems</h4>
      <div className="row wrap gap-sm">
        {Object.entries(s.ecosystems).map(([eco, c]) => (
          <span key={eco} className="tag big">
            {ecoIcon(eco)} {eco} <b>{c}</b>
          </span>
        ))}
      </div>
      {r.notes.length > 0 && (
        <>
          <h4 className="panel-h">Notes</h4>
          <ul className="notes">
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: 'danger' | 'good' | 'warn' }) {
  return (
    <motion.div className={`tile ${tone ?? ''}`} whileHover={{ y: -3 }}>
      <span className="tile-label">{label}</span>
      <b className="tile-value">
        <CountUp value={value} />
      </b>
      <span className="tile-sub">{sub}</span>
    </motion.div>
  );
}
