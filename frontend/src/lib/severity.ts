import type { PackageNode, Severity } from './types';

export const SEV_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'NONE', 'NOT_SCANNED'];

export const SEV_META: Record<Severity, { label: string; color: string; glow: number; short: string }> = {
  CRITICAL: { label: 'Critical', color: '#ff4436', glow: 2.2, short: 'CRIT' },
  HIGH: { label: 'High', color: '#ff8a3d', glow: 1.5, short: 'HIGH' },
  MEDIUM: { label: 'Medium', color: '#f2c94c', glow: 0.9, short: 'MED' },
  LOW: { label: 'Low', color: '#6cc4e8', glow: 0.6, short: 'LOW' },
  UNKNOWN: { label: 'Unscored advisory', color: '#b49cf0', glow: 0.7, short: '???' },
  NONE: { label: 'No known advisories', color: '#eadfd3', glow: 0, short: 'OK' },
  NOT_SCANNED: { label: 'Not scanned', color: '#3a3640', glow: 0, short: 'N/A' },
};

export const RISK_COLOR = (score?: number) =>
  score == null ? '#6b6b80' : score >= 65 ? '#ff4436' : score >= 45 ? '#ff8a3d' : score >= 25 ? '#f2c94c' : '#5bd69a';

export const sevRank = (s: Severity) => SEV_ORDER.indexOf(s);

export const isVulnerable = (p: PackageNode) => p.vulns.length > 0;

export const VERSION_SOURCE_LABEL: Record<PackageNode['versionSource'], string> = {
  lockfile: 'Exact version from lockfile',
  pinned: 'Pinned in manifest',
  'resolved-range': 'Resolved from the declared range (newest matching release)',
  'deps.dev-resolved': "Transitive version predicted by deps.dev's resolver (no lockfile)",
  unresolved: 'Version could not be resolved',
};

/** One colour per letter grade, so the badge and the ring always agree with the letter. */
export const GRADE_COLOR: Record<string, string> = { A: '#4dffb5', B: '#b8e05a', C: '#ffd23f', D: '#ff8a3d', F: '#ff4436' };
