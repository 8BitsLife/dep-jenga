import type { PackageNode, Severity } from './types';

export const SEV_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'NONE', 'NOT_SCANNED'];

export const SEV_META: Record<Severity, { label: string; color: string; glow: number; short: string }> = {
  CRITICAL: { label: 'Critical', color: '#ff2e63', glow: 2.6, short: 'CRIT' },
  HIGH: { label: 'High', color: '#ff8a1f', glow: 1.8, short: 'HIGH' },
  MEDIUM: { label: 'Medium', color: '#ffd23f', glow: 1.1, short: 'MED' },
  LOW: { label: 'Low', color: '#3ddcff', glow: 0.7, short: 'LOW' },
  UNKNOWN: { label: 'Unscored advisory', color: '#b48cff', glow: 0.9, short: '???' },
  NONE: { label: 'No known advisories', color: '#38406e', glow: 0, short: 'OK' },
  NOT_SCANNED: { label: 'Not scanned', color: '#3a3a4a', glow: 0, short: 'N/A' },
};

export const RISK_COLOR = (score?: number) =>
  score == null ? '#6b6b80' : score >= 65 ? '#ff2e63' : score >= 45 ? '#ff8a1f' : score >= 25 ? '#ffd23f' : '#4dffb5';

export const sevRank = (s: Severity) => SEV_ORDER.indexOf(s);

export const isVulnerable = (p: PackageNode) => p.vulns.length > 0;

export const VERSION_SOURCE_LABEL: Record<PackageNode['versionSource'], string> = {
  lockfile: 'Exact version from lockfile',
  pinned: 'Pinned in manifest',
  'resolved-range': 'Resolved from the declared range (newest matching release)',
  'deps.dev-resolved': "Transitive version predicted by deps.dev's resolver (no lockfile)",
  unresolved: 'Version could not be resolved',
};
