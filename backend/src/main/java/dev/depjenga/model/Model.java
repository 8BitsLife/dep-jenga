package dev.depjenga.model;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Wire model returned to the frontend. Every field that comes from an external source is
 * nullable: null means "we could not get this", never "zero" — the UI renders it as unavailable.
 */
public final class Model {
    private Model() {}

    public static class RepoInfo {
        public String owner, name, fullName, url, description, defaultBranch, ref, language, license, pushedAt;
        public Integer stars, forks, openIssues;
        public boolean archived;
        public boolean metadataAvailable;
    }

    public static class ManifestInfo {
        public String path, ecosystem, kind, parser;
        public int packages;
        public List<String> notes = new ArrayList<>();
    }

    public static class PackageNode {
        public String id, name, version, ecosystem, system, versionSource, declaredRange, manifest;
        public boolean direct, dev;
        public int depth = -1;
        public int dependents, dependencies, transitiveDependents;
        /** CRITICAL | HIGH | MEDIUM | LOW | NONE (scanned, nothing found) | UNKNOWN (advisory without a usable score) | NOT_SCANNED */
        public String severity = "NOT_SCANNED";
        public Double maxCvss;
        public String scanStatus = "not-scanned";
        public String scanNote;
        public List<Vuln> vulns = new ArrayList<>();
        public Risk risk = new Risk();
        public Meta meta = new Meta();
        public Fix fix;
    }

    public static class Vuln {
        public String id, summary, details, severity, cvssVector, severitySource, published, modified, url, ghsaUrl;
        public Double cvssScore;
        public boolean malicious;
        public List<String> aliases = new ArrayList<>();
        public List<String> fixedVersions = new ArrayList<>();
        public List<String> references = new ArrayList<>();
        public List<String> cwes = new ArrayList<>();
    }

    public static class Risk {
        /** 0-100, higher = riskier. Null when no signal was available. */
        public Integer score;
        public String level = "UNKNOWN";
        public boolean available;
        public List<RiskFactor> factors = new ArrayList<>();
        public List<String> missing = new ArrayList<>();
    }

    public static class RiskFactor {
        public String name, value, detail, source;
        public double points, maxPoints;
    }

    public static class Meta {
        public String latestVersion, publishedAt, latestPublishedAt, license, sourceRepo, homepage, registryUrl;
        public Integer stars, maintainers;
        public Double scorecard;
        public Boolean deprecated;
    }

    public static class Fix {
        public String recommendedVersion, command, note;
        public boolean fixesAll;
        public List<String> resolves = new ArrayList<>();
        public List<String> unresolved = new ArrayList<>();
    }

    public static class Edge {
        public String from, to;

        public Edge() {}

        public Edge(String from, String to) {
            this.from = from;
            this.to = to;
        }
    }

    public static class Summary {
        public int totalPackages, direct, transitive, dev, scanned, notScanned, vulnerablePackages, uniqueAdvisories;
        public int riskAvailable, highBusRisk, fixable, unfixable, omittedPackages;
        public Double avgBusRisk;
        public int overallScore;
        public String grade;
        public boolean truncated;
        public Map<String, Integer> severityCounts = new LinkedHashMap<>();
        public Map<String, Integer> advisorySeverityCounts = new LinkedHashMap<>();
        public Map<String, Integer> ecosystems = new LinkedHashMap<>();
        public List<String> scoreExplanation = new ArrayList<>();
    }

    public static class SourceStatus {
        public String name, url, message;
        public boolean ok = true;
        public int calls, failures;
    }

    public static class AnalysisResult {
        public RepoInfo repo;
        public String rootId;
        public List<PackageNode> packages = new ArrayList<>();
        public List<Edge> edges = new ArrayList<>();
        public List<ManifestInfo> manifests = new ArrayList<>();
        public Summary summary;
        public List<SourceStatus> sources = new ArrayList<>();
        public List<String> notes = new ArrayList<>();
        public String generatedAt;
        public long durationMs;
    }
}
