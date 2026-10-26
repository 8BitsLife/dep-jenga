import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { threatOrder } from '../lib/graph';
import { buildMarkdownReport, download } from '../lib/report';
import { SEV_META } from '../lib/severity';
import { useStore } from '../store';
import { CopyButton, Key, SevChip } from './ui';

export function FixPanel() {
  const r = useStore((s) => s.result)!;
  const select = useStore((s) => s.select);
  const items = useMemo(() => r.packages.filter((p) => p.vulns.length).sort(threatOrder), [r]);
  const commands = items.map((p) => p.fix?.command).filter(Boolean) as string[];
  const uniqueCmds = [...new Set(commands)];

  return (
    <div className="panel-body">
      <p className="fine">
        Fix versions come straight from the advisories' published "fixed" events. Each recommendation was re-checked against OSV so you don't upgrade into another known vulnerability.
      </p>
      <div className="row wrap gap-sm">
        {uniqueCmds.length > 0 && <CopyButton text={uniqueCmds.join('\n')} label={`Copy all ${uniqueCmds.length} commands`} />}
        <Key tone="ghost" onClick={() => download(`${r.repo.name}-depjenga.md`, buildMarkdownReport(r), 'text/markdown')}>
          ⇩ Report .md
        </Key>
        <Key tone="ghost" onClick={() => download(`${r.repo.name}-depjenga.json`, JSON.stringify(r, null, 2), 'application/json')}>
          ⇩ Raw .json
        </Key>
      </div>

      {items.length === 0 && <div className="empty ok">Nothing to fix: no package version in this tree matches a known advisory.</div>}

      <div className="fix-list">
        {items.map((p, i) => (
          <motion.div
            key={p.id}
            className="fix-card"
            style={{ ['--sev' as string]: SEV_META[p.severity].color }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 12) * 0.04 }}
          >
            <div className="fix-card-top">
              <button className="fix-name" onClick={() => select(p.id)}>
                {p.name}
              </button>
              <SevChip severity={p.severity} small />
            </div>
            <div className="fix-versions">
              <span className="from">{p.version}</span>
              <span className="arrow">→</span>
              {p.fix?.recommendedVersion ? <span className="to">{p.fix.recommendedVersion}</span> : <span className="none">no fix published</span>}
              <span className="tag">{p.direct ? 'direct' : 'transitive'}</span>
            </div>
            {p.fix?.command && (
              <div className="cmd">
                <code>{p.fix.command}</code>
                <CopyButton text={p.fix.command} />
              </div>
            )}
            {p.fix?.note && <p className="fine">{p.fix.note}</p>}
            <div className="fix-ids">
              {p.vulns.map((v) => (
                <a key={v.id} href={v.url} target="_blank" rel="noreferrer" className={`fix-id ${p.fix?.unresolved.includes(v.id) ? 'open' : ''}`} style={{ ['--sev' as string]: SEV_META[v.severity].color }}>
                  {v.aliases.find((a) => a.startsWith('CVE-')) ?? v.id}
                </a>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
