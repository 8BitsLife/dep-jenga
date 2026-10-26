// Mirrors dev.depjenga.model.Model on the backend. Nullable fields mean "data unavailable".

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'NONE' | 'NOT_SCANNED';

export interface Vuln {
  id: string;
  summary?: string;
  details?: string;
  severity: Severity;
  cvssVector?: string;
  cvssScore?: number;
  severitySource?: string;
  published?: string;
  modified?: string;
  url?: string;
  ghsaUrl?: string;
  malicious?: boolean;
  aliases: string[];
  fixedVersions: string[];
  references: string[];
  cwes: string[];
}

export interface RiskFactor {
  name: string;
  value: string;
  detail?: string;
  source: string;
  points: number;
  maxPoints: number;
}

export interface Risk {
  score?: number;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' | 'UNKNOWN';
  available: boolean;
  factors: RiskFactor[];
  missing: string[];
}

export interface Meta {
  latestVersion?: string;
  publishedAt?: string;
  latestPublishedAt?: string;
  license?: string;
  sourceRepo?: string;
  homepage?: string;
  registryUrl?: string;
  stars?: number;
  maintainers?: number;
  scorecard?: number;
  deprecated?: boolean;
}

export interface Fix {
  recommendedVersion?: string;
  command?: string;
  note?: string;
  fixesAll: boolean;
  resolves: string[];
  unresolved: string[];
}

export interface PackageNode {
  id: string;
  name: string;
  version?: string;
  ecosystem: string;
  system?: string;
  versionSource: 'lockfile' | 'pinned' | 'resolved-range' | 'deps.dev-resolved' | 'unresolved';
  declaredRange?: string;
  manifest?: string;
  direct: boolean;
  dev: boolean;
  depth: number;
  dependents: number;
  dependencies: number;
  transitiveDependents: number;
  severity: Severity;
  maxCvss?: number;
  scanStatus: string;
  scanNote?: string;
  vulns: Vuln[];
  risk: Risk;
  meta: Meta;
  fix?: Fix;
}

export interface Edge {
  from: string;
  to: string;
}

export interface Summary {
  totalPackages: number;
  direct: number;
  transitive: number;
  dev: number;
  scanned: number;
  notScanned: number;
  vulnerablePackages: number;
  uniqueAdvisories: number;
  riskAvailable: number;
  highBusRisk: number;
  fixable: number;
  unfixable: number;
  omittedPackages: number;
  avgBusRisk?: number;
  overallScore: number;
  grade: string;
  truncated: boolean;
  severityCounts: Record<string, number>;
  advisorySeverityCounts: Record<string, number>;
  ecosystems: Record<string, number>;
  scoreExplanation: string[];
}

export interface SourceStatus {
  name: string;
  url?: string;
  message?: string;
  ok: boolean;
  calls: number;
  failures: number;
}

export interface ManifestInfo {
  path: string;
  ecosystem: string;
  kind: string;
  parser: string;
  packages: number;
  notes: string[];
}

export interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  description?: string;
  defaultBranch?: string;
  ref?: string;
  language?: string;
  license?: string;
  pushedAt?: string;
  stars?: number;
  forks?: number;
  openIssues?: number;
  archived: boolean;
  metadataAvailable: boolean;
}

export interface AnalysisResult {
  repo: RepoInfo;
  rootId: string;
  packages: PackageNode[];
  edges: Edge[];
  manifests: ManifestInfo[];
  summary: Summary;
  sources: SourceStatus[];
  notes: string[];
  generatedAt: string;
  durationMs: number;
}

export interface ProgressEvent {
  stage: string;
  message: string;
  pct: number;
}
