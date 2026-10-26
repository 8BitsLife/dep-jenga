package dev.depjenga.analysis;

import com.fasterxml.jackson.databind.JsonNode;
import dev.depjenga.model.Model.PackageNode;
import dev.depjenga.model.Model.Risk;
import dev.depjenga.model.Model.RiskFactor;
import dev.depjenga.sources.DepsDevClient;
import dev.depjenga.sources.NpmRegistryClient;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Maintainer / bus-factor risk from real registry and OpenSSF Scorecard signals. Each factor records
 * its source; factors we could not observe are listed in {@code missing} and excluded from the score
 * (the score is normalized over the factors that were actually observed).
 */
@Service
public class RiskService {
    private final DepsDevClient depsDev;
    private final NpmRegistryClient npm;

    public RiskService(DepsDevClient depsDev, NpmRegistryClient npm) {
        this.depsDev = depsDev;
        this.npm = npm;
    }

    public void enrich(List<PackageNode> packages, SourceLog sl, AnalysisService.Progress progress) {
        progress.emit("risk", "Gathering maintainer, release and OpenSSF Scorecard signals", 66);
        AnalysisService.parallel(packages, n -> enrichOne(n, sl), progress, "risk",
                "Measuring bus factor and maintenance health", 66, 92);
    }

    private void enrichOne(PackageNode n, SourceLog sl) {
        Risk r = n.risk;
        if (n.system == null) {
            r.missing.add("deps.dev does not cover the " + n.ecosystem + " ecosystem, so no maintainer signals are available");
            return;
        }
        String name = AnalysisService.ddName(n.system, n.name);
        n.meta.registryUrl = "https://deps.dev/" + n.system.toLowerCase() + "/" + java.net.URLEncoder.encode(name, java.nio.charset.StandardCharsets.UTF_8)
                + (n.version != null ? "/" + n.version : "");

        JsonNode pkg = depsDev.getPackage(n.system, name, sl);
        if (pkg != null) {
            // "latest release" = the most recently published version of any line, not the default dist-tag
            for (JsonNode v : pkg.path("versions")) {
                if (v.path("isDefault").asBoolean(false)) n.meta.latestVersion = v.path("versionKey").path("version").asText(null);
                String at = v.path("publishedAt").asText(null);
                if (at != null && (n.meta.latestPublishedAt == null || at.compareTo(n.meta.latestPublishedAt) > 0)) n.meta.latestPublishedAt = at;
            }
        }
        String projectId = null;
        if (n.version != null) {
            JsonNode ver = depsDev.getVersion(n.system, name, n.version, sl);
            if (ver != null) {
                n.meta.publishedAt = ver.path("publishedAt").asText(null);
                if (ver.has("isDeprecated")) n.meta.deprecated = ver.path("isDeprecated").asBoolean(false);
                if (ver.path("licenses").size() > 0) n.meta.license = ver.path("licenses").get(0).asText();
                for (JsonNode l : ver.path("links")) {
                    if ("HOMEPAGE".equals(l.path("label").asText())) n.meta.homepage = l.path("url").asText();
                }
                for (JsonNode rp : ver.path("relatedProjects")) {
                    if ("SOURCE_REPO".equals(rp.path("relationType").asText())) {
                        projectId = rp.path("projectKey").path("id").asText(null);
                        break;
                    }
                }
            }
        }

        // ---- factor: npm maintainer count (the most literal bus-factor signal we can observe)
        if ("npm".equals(n.ecosystem)) {
            JsonNode latest = npm.latest(n.name, sl);
            if (latest != null && latest.path("maintainers").isArray()) {
                int m = latest.path("maintainers").size();
                n.meta.maintainers = m;
                double pts = m <= 1 ? 35 : m == 2 ? 20 : m <= 4 ? 8 : 0;
                factor(r, "Maintainers", m + (m == 1 ? " maintainer" : " maintainers"),
                        m <= 1 ? "A single person can publish (or abandon) this package" : "Publishing rights are shared", "npm registry", pts, 35);
            } else {
                r.missing.add("npm maintainer list unavailable");
            }
        } else {
            r.missing.add("Maintainer count is only published by the npm registry");
        }

        // ---- factor: release freshness
        if (n.meta.latestPublishedAt != null) {
            try {
                long days = Duration.between(Instant.parse(n.meta.latestPublishedAt), Instant.now()).toDays();
                double pts = days > 730 ? 25 : days > 365 ? 15 : days > 180 ? 5 : 0;
                factor(r, "Release activity", days + " days since latest release",
                        days > 730 ? "No release in over two years" : days > 365 ? "No release in over a year" : "Recently released",
                        "deps.dev", pts, 25);
            } catch (Exception ignored) {
                r.missing.add("Release date unparseable");
            }
        } else {
            r.missing.add("Latest release date unavailable");
        }

        // ---- factor: deprecation
        if (n.meta.deprecated != null) {
            factor(r, "Deprecation", n.meta.deprecated ? "Deprecated" : "Not deprecated",
                    n.meta.deprecated ? "The registry marks this version deprecated" : "", "deps.dev", n.meta.deprecated ? 20 : 0, 20);
        }

        // ---- factors: OpenSSF Scorecard
        if (projectId != null) {
            n.meta.sourceRepo = projectId;
            JsonNode project = depsDev.getProject(projectId, sl);
            if (project != null) {
                if (project.has("starsCount")) n.meta.stars = project.path("starsCount").asInt();
                JsonNode sc = project.path("scorecard");
                if (!sc.isMissingNode() && sc.has("overallScore")) {
                    n.meta.scorecard = sc.path("overallScore").asDouble();
                    for (JsonNode check : sc.path("checks")) {
                        String cn = check.path("name").asText();
                        int s = check.path("score").asInt(-1);
                        if (s < 0) continue;
                        String reason = check.path("reason").asText("");
                        switch (cn) {
                            case "Maintained" -> factor(r, "Maintenance activity", s + "/10", reason, "OpenSSF Scorecard (via deps.dev)", (10 - s) * 3.0, 30);
                            case "Contributors" -> factor(r, "Contributor diversity", s + "/10", reason, "OpenSSF Scorecard (via deps.dev)", (10 - s) * 2.5, 25);
                            case "Code-Review" -> factor(r, "Code review", s + "/10", reason, "OpenSSF Scorecard (via deps.dev)", (10 - s) * 1.5, 15);
                            default -> {}
                        }
                    }
                } else {
                    r.missing.add("No OpenSSF Scorecard published for " + projectId);
                }
            } else {
                r.missing.add("Source repository metadata unavailable");
            }
        } else {
            r.missing.add("No linked source repository, so OpenSSF Scorecard signals are unavailable");
        }

        double pts = r.factors.stream().mapToDouble(f -> f.points).sum();
        double max = r.factors.stream().mapToDouble(f -> f.maxPoints).sum();
        boolean meaningful = r.factors.stream().anyMatch(f -> !f.name.equals("Deprecation"));
        if (max > 0 && meaningful) {
            r.available = true;
            r.score = (int) Math.round(100 * pts / max);
            r.level = r.score >= 65 ? "SEVERE" : r.score >= 45 ? "HIGH" : r.score >= 25 ? "MODERATE" : "LOW";
        }
    }

    private static void factor(Risk r, String name, String value, String detail, String source, double pts, double max) {
        RiskFactor f = new RiskFactor();
        f.name = name;
        f.value = value;
        f.detail = detail;
        f.source = source;
        f.points = Math.max(0, Math.min(max, pts));
        f.maxPoints = max;
        r.factors.add(f);
    }
}
