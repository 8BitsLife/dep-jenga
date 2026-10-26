import { threatOrder } from './graph';
import { SEV_META } from './severity';
import type { AnalysisResult } from './types';

export function buildMarkdownReport(r: AnalysisResult): string {
  const s = r.summary;
  const lines: string[] = [];
  lines.push(`# DepJenga report — ${r.repo.fullName}`, '');
  lines.push(`Generated ${r.generatedAt} · ref \`${r.repo.ref ?? 'default'}\``, '');
  lines.push(`**Collapse risk:** ${s.overallScore}/100 (grade ${s.grade})`, '');
  s.scoreExplanation.forEach((e) => lines.push(`- ${e}`));
  lines.push('', '| Metric | Value |', '|---|---|');
  lines.push(`| Packages | ${s.totalPackages} (${s.direct} direct, ${s.transitive} transitive) |`);
  lines.push(`| Vulnerable packages | ${s.vulnerablePackages} |`);
  lines.push(`| Unique advisories | ${s.uniqueAdvisories} |`);
  lines.push(`| Fixable / no fix | ${s.fixable} / ${s.unfixable} |`);
  lines.push(`| Avg bus-factor risk | ${s.avgBusRisk ?? 'unavailable'} |`, '');
  const vuln = r.packages.filter((p) => p.vulns.length).sort(threatOrder);
  if (vuln.length) {
    lines.push('## Vulnerable packages', '');
    for (const p of vuln) {
      lines.push(`### ${p.name}@${p.version} — ${SEV_META[p.severity].label}${p.direct ? ' (direct)' : ''}`);
      for (const v of p.vulns) {
        const cve = v.aliases.find((a) => a.startsWith('CVE-'));
        lines.push(`- **${v.id}**${cve ? ` / ${cve}` : ''} — ${v.severity}${v.cvssScore != null ? ` (CVSS ${v.cvssScore})` : ''}: ${v.summary ?? ''} — ${v.url}`);
      }
      if (p.fix?.recommendedVersion) lines.push(`- Fix: upgrade to **${p.fix.recommendedVersion}**${p.fix.command ? ` — \`${p.fix.command}\`` : ''}`);
      if (p.fix?.note) lines.push(`- ${p.fix.note}`);
      lines.push('');
    }
  }
  lines.push('## Data sources', '');
  r.sources.forEach((src) => lines.push(`- ${src.name}: ${src.calls} calls${src.failures ? `, ${src.failures} failed` : ''}${src.message ? ` — ${src.message}` : ''}`));
  if (r.notes.length) {
    lines.push('', '## Notes', '');
    r.notes.forEach((n) => lines.push(`- ${n}`));
  }
  return lines.join('\n');
}

export function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
