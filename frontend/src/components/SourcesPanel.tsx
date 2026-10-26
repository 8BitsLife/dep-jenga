import { useStore } from '../store';
import { fmtDate } from './ui';

export function SourcesPanel() {
  const r = useStore((s) => s.result)!;
  return (
    <div className="panel-body">
      <h4 className="panel-h">Data sources this scan used</h4>
      <div className="sources">
        {r.sources.map((s) => {
          const state = s.calls === 0 ? (s.message ? 'bad' : 'idle') : s.failures === 0 ? 'ok' : s.failures < s.calls ? 'partial' : 'bad';
          return (
            <div key={s.name} className={`source ${state}`}>
              <span className="source-dot" />
              <div className="source-main">
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
                <small>
                  {s.calls === 0 ? 'not needed for this repo' : `${s.calls} request${s.calls === 1 ? '' : 's'}${s.failures ? ` · ${s.failures} failed` : ''}`}
                </small>
                {s.message && <em>{s.message}</em>}
              </div>
            </div>
          );
        })}
      </div>

      <h4 className="panel-h">Manifests analyzed</h4>
      {r.manifests.map((m) => (
        <div key={m.path} className="manifest">
          <div className="row between">
            <code>{m.path}</code>
            <span className="tag">{m.kind === 'lockfile' ? 'lockfile · exact' : 'manifest · resolved'}</span>
          </div>
          <small>
            {m.ecosystem} · {m.packages} entries · parsed as {m.parser}
          </small>
          {m.notes.map((n) => (
            <div key={n} className="fine">
              ↳ {n}
            </div>
          ))}
        </div>
      ))}

      <h4 className="panel-h">Method</h4>
      <ul className="method">
        <li>
          <b>Tree:</b> lockfiles give the exact installed tree. Without a lockfile, declared ranges are resolved to the newest matching release and the transitive tree comes from
          deps.dev's resolver — those packages are labeled as predicted, not installed.
        </li>
        <li>
          <b>Vulnerabilities:</b> every exact package version is queried against OSV.dev. Severity prefers the GitHub Advisory Database label, then GitHub's severity mirrored in OSV, then a
          CVSS v3 base score computed from the advisory's own vector. If none exists the advisory is shown as <i>unscored</i>, never guessed.
        </li>
        <li>
          <b>Bus factor:</b> npm maintainer count, OpenSSF Scorecard (Maintained, Contributors, Code-Review), days since the last release and deprecation status. The score is normalised over
          the signals that were actually observed; packages with no signals get no score.
        </li>
        <li>
          <b>Fixes:</b> the smallest published fixed version above yours for each advisory; the recommendation is the highest of those, re-checked against OSV.
        </li>
        <li>
          <b>Tower:</b> up to 108 blocks. Bottom = most depended-upon. Color = worst advisory. Width = bus-factor risk. Hatching = data unavailable.
        </li>
      </ul>
      <p className="fine">
        Generated {fmtDate(r.generatedAt)} in {(r.durationMs / 1000).toFixed(1)}s. Advisory databases change daily; re-scan before acting.
      </p>
    </div>
  );
}
