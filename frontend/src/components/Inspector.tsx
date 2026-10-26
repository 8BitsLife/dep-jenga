import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { pathFromRoot } from '../lib/graph';
import { RISK_COLOR, SEV_META, VERSION_SOURCE_LABEL } from '../lib/severity';
import type { PackageNode, Vuln } from '../lib/types';
import { useStore } from '../store';
import { CopyButton, Key, Ring, SevChip, Unavailable, ecoIcon, fmtDate } from './ui';

export function Inspector() {
  const id = useStore((s) => s.selectedId);
  const graph = useStore((s) => s.graph);
  const p = id ? graph?.byId.get(id) : undefined;
  if (!p || !graph) return null;
  return <InspectorBody key={p.id} p={p} />;
}

function InspectorBody({ p }: { p: PackageNode }) {
  const graph = useStore((s) => s.graph)!;
  const repoName = useStore((s) => s.result?.repo.name);
  const select = useStore((s) => s.select);
  const showBlast = useStore((s) => s.showBlast);
  const setTool = useStore((s) => s.setTool);
  const pull = useStore((s) => s.pull);
  const inTower = useStore((s) => s.blocks.some((b) => b.id === p.id));
  const path = useMemo(() => pathFromRoot(graph, p.id), [graph, p.id]);
  const meta = SEV_META[p.severity];

  return (
    <motion.aside
      className="inspector glass"
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 420, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      style={{ ['--sev' as string]: meta.color }}
    >
      <div className="insp-glow" />
      <header className="insp-head">
        <div className="insp-eco">
          {ecoIcon(p.ecosystem)} {p.ecosystem}
        </div>
        <button className="icon-btn close" onClick={() => select(undefined)} title="Close (Esc)">
          ✕
        </button>
        <h2 className="insp-name">{p.name}</h2>
        <div className="insp-version">
          {p.version ?? <Unavailable>version unresolved</Unavailable>}
          {p.meta.latestVersion && p.version && p.meta.latestVersion !== p.version && <span className="latest">latest {p.meta.latestVersion}</span>}
        </div>
        <div className="row wrap gap-sm">
          <SevChip severity={p.severity} count={p.vulns.length || undefined} />
          <span className="tag">{p.direct ? 'direct' : `transitive · depth ${p.depth}`}</span>
          {p.dev && <span className="tag">dev only</span>}
          {p.meta.deprecated && <span className="tag warn">deprecated</span>}
        </div>
      </header>

      <div className="insp-actions">
        <Key
          tone="danger"
          onClick={() => {
            setTool('blast');
            showBlast(p.id);
          }}
        >
          ✺ Blast radius <b className="key-count">{p.transitiveDependents}</b>
        </Key>
        {inTower && (
          <Key onClick={() => pull(p.id)}>
            ✋ Pull block
          </Key>
        )}
      </div>

      <div className="insp-scroll">
        <Section title={`Vulnerabilities${p.vulns.length ? ` · ${p.vulns.length}` : ''}`}>
          {p.scanStatus !== 'scanned' ? (
            <div className="empty hatched">Not scanned — {p.scanNote ?? 'no data'}</div>
          ) : p.vulns.length === 0 ? (
            <div className="empty ok">No known advisories in OSV for this exact version.</div>
          ) : (
            p.vulns.map((v) => <VulnCard key={v.id} v={v} />)
          )}
        </Section>

        {p.fix && (
          <Section title="Fix">
            {p.fix.recommendedVersion ? (
              <div className="fix-box">
                <div className="fix-versions">
                  <span className="from">{p.version}</span>
                  <span className="arrow">→</span>
                  <span className="to">{p.fix.recommendedVersion}</span>
                  <span className={`tag ${p.fix.fixesAll ? 'good' : 'warn'}`}>{p.fix.fixesAll ? `fixes all ${p.fix.resolves.length}` : `fixes ${p.fix.resolves.length}/${p.vulns.length}`}</span>
                </div>
                {p.fix.command && (
                  <div className="cmd">
                    <code>{p.fix.command}</code>
                    <CopyButton text={p.fix.command} />
                  </div>
                )}
                {p.fix.note && <p className="fine">{p.fix.note}</p>}
              </div>
            ) : (
              <div className="empty danger">{p.fix.note}</div>
            )}
          </Section>
        )}

        <Section title="Maintainer & bus-factor risk">
          <RiskBlock p={p} />
        </Section>

        <Section title="How your project reaches it">
          <div className="path">
            <span className="path-node root">{repoName}</span>
            {path.map((pid) => {
              const n = graph.byId.get(pid);
              return (
                <span key={pid} className="path-step">
                  <span className="path-arrow">→</span>
                  <button className={`path-node ${pid === p.id ? 'me' : ''}`} style={{ ['--sev' as string]: n ? SEV_META[n.severity].color : undefined }} onClick={() => select(pid)}>
                    {n?.name ?? pid}
                  </button>
                </span>
              );
            })}
          </div>
          <div className="stat-row">
            <Stat label="Direct dependents" value={p.dependents} />
            <Stat label="All dependents" value={p.transitiveDependents} />
            <Stat label="Own dependencies" value={p.dependencies} />
          </div>
        </Section>

        <Section title="Provenance">
          <dl className="kv">
            <dt>Version source</dt>
            <dd>{VERSION_SOURCE_LABEL[p.versionSource]}</dd>
            {p.declaredRange && p.declaredRange !== p.version && (
              <>
                <dt>Declared</dt>
                <dd>
                  <code>{p.declaredRange}</code>
                </dd>
              </>
            )}
            <dt>Manifest</dt>
            <dd>
              <code>{p.manifest}</code>
            </dd>
            <dt>Published</dt>
            <dd>{fmtDate(p.meta.publishedAt) ?? <Unavailable>unavailable</Unavailable>}</dd>
            <dt>License</dt>
            <dd>{p.meta.license ?? <Unavailable>unavailable</Unavailable>}</dd>
            <dt>Source repo</dt>
            <dd>
              {p.meta.sourceRepo ? (
                <a href={`https://${p.meta.sourceRepo}`} target="_blank" rel="noreferrer">
                  {p.meta.sourceRepo}
                </a>
              ) : (
                <Unavailable>not linked</Unavailable>
              )}
            </dd>
            <dt>Stars</dt>
            <dd>{p.meta.stars != null ? p.meta.stars.toLocaleString() : <Unavailable>unavailable</Unavailable>}</dd>
          </dl>
          {p.meta.registryUrl && (
            <a className="ext" href={p.meta.registryUrl} target="_blank" rel="noreferrer">
              Open on deps.dev ↗
            </a>
          )}
        </Section>
      </div>
    </motion.aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="insp-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function VulnCard({ v }: { v: Vuln }) {
  const [open, setOpen] = useState(false);
  const m = SEV_META[v.severity];
  const cve = v.aliases.find((a) => a.startsWith('CVE-'));
  return (
    <motion.div layout className={`vuln ${open ? 'open' : ''}`} style={{ ['--sev' as string]: m.color }} onClick={() => setOpen(!open)}>
      <div className="vuln-top">
        <span className="vuln-sev">{m.short}</span>
        <span className="vuln-id">{cve ?? v.id}</span>
        {v.cvssScore != null ? <span className="vuln-cvss">CVSS {v.cvssScore.toFixed(1)}</span> : <Unavailable>no CVSS</Unavailable>}
      </div>
      <div className="vuln-summary">{v.malicious ? '☠ Malicious package report: ' : ''}{v.summary}</div>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="vuln-more" onClick={(e) => e.stopPropagation()}>
          {v.details && <p className="vuln-details">{v.details}</p>}
          <dl className="kv">
            <dt>Severity from</dt>
            <dd>{v.severitySource}</dd>
            {v.cvssVector && (
              <>
                <dt>Vector</dt>
                <dd>
                  <code className="small">{v.cvssVector}</code>
                </dd>
              </>
            )}
            <dt>Fixed in</dt>
            <dd>{v.fixedVersions.length ? v.fixedVersions.join(', ') : <Unavailable>no fixed version published</Unavailable>}</dd>
            {v.aliases.length > 0 && (
              <>
                <dt>Aliases</dt>
                <dd>{v.aliases.join(', ')}</dd>
              </>
            )}
            {v.cwes.length > 0 && (
              <>
                <dt>Weakness</dt>
                <dd>{v.cwes.join(', ')}</dd>
              </>
            )}
            <dt>Published</dt>
            <dd>{fmtDate(v.published) ?? '—'}</dd>
          </dl>
          <div className="row wrap gap-sm">
            {v.url && (
              <a className="ext" href={v.url} target="_blank" rel="noreferrer">
                OSV ↗
              </a>
            )}
            {v.ghsaUrl && (
              <a className="ext" href={v.ghsaUrl} target="_blank" rel="noreferrer">
                GitHub Advisory ↗
              </a>
            )}
            {v.references.slice(0, 3).map((r) => (
              <a key={r} className="ext dim" href={r} target="_blank" rel="noreferrer">
                {new URL(r).hostname} ↗
              </a>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function RiskBlock({ p }: { p: PackageNode }) {
  const r = p.risk;
  return (
    <div className="risk">
      <div className="risk-top">
        <Ring
          value={r.available ? r.score ?? 0 : null}
          size={86}
          stroke={8}
          color={RISK_COLOR(r.score)}
          label={r.available ? <span style={{ color: RISK_COLOR(r.score) }}>{r.score}</span> : <span className="unavailable">n/a</span>}
          sub={r.available ? r.level.toLowerCase() : 'no data'}
        />
        <p className="fine">
          {r.available
            ? 'Score normalised over the signals we could actually observe. Higher = more fragile. Thinner block in the tower.'
            : 'No maintainer signals were available for this package, so no score is shown. Its block keeps full width with hatching.'}
        </p>
      </div>
      {r.factors.map((f) => (
        <div key={f.name} className="factor">
          <div className="factor-top">
            <span>{f.name}</span>
            <b>{f.value}</b>
          </div>
          <div className="factor-bar">
            <motion.span initial={{ width: 0 }} animate={{ width: `${(f.points / f.maxPoints) * 100}%` }} style={{ background: RISK_COLOR((f.points / f.maxPoints) * 100) }} />
          </div>
          <div className="factor-src">
            {f.detail && <span>{f.detail} · </span>}
            {f.source}
          </div>
        </div>
      ))}
      {r.missing.length > 0 && (
        <div className="missing">
          <span className="hatch-swatch" />
          <div>
            {r.missing.map((m) => (
              <div key={m}>{m}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
