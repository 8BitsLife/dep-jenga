package dev.depjenga.analysis;

import dev.depjenga.model.Model.AnalysisResult;
import dev.depjenga.model.Model.PackageNode;
import dev.depjenga.model.Model.Summary;
import dev.depjenga.model.Model.Vuln;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Repository-level "collapse risk": a transparent blend of vulnerability load and bus-factor risk. */
final class Scoring {
    private Scoring() {}

    private static final Map<String, Integer> WEIGHT = Map.of("CRITICAL", 30, "HIGH", 15, "MEDIUM", 6, "LOW", 2, "UNKNOWN", 4);

    static Summary summarize(AnalysisResult r, int omitted) {
        Summary s = new Summary();
        for (String k : List.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN", "NONE", "NOT_SCANNED")) s.severityCounts.put(k, 0);
        for (String k : List.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")) s.advisorySeverityCounts.put(k, 0);
        Set<String> advisories = new HashSet<>();
        Map<String, String> advisorySev = new HashMap<>();
        double vulnPts = 0, riskSum = 0, riskWeight = 0;
        for (PackageNode n : r.packages) {
            s.totalPackages++;
            if (n.direct) s.direct++;
            else s.transitive++;
            if (n.dev) s.dev++;
            if ("scanned".equals(n.scanStatus)) s.scanned++;
            else s.notScanned++;
            s.severityCounts.merge(n.severity, 1, Integer::sum);
            s.ecosystems.merge(n.ecosystem, 1, Integer::sum);
            if (!n.vulns.isEmpty()) {
                s.vulnerablePackages++;
                vulnPts += WEIGHT.getOrDefault(n.severity, 4) * (n.dev ? 0.5 : 1.0);
                for (Vuln v : n.vulns) {
                    advisories.add(v.id);
                    advisorySev.putIfAbsent(v.id, v.severity);
                }
                if (n.fix != null && n.fix.recommendedVersion != null) s.fixable++;
                else s.unfixable++;
            }
            if (n.risk.available) {
                s.riskAvailable++;
                double w = n.direct ? 2 : 1;
                riskSum += n.risk.score * w;
                riskWeight += w;
                if (n.risk.score >= 45) s.highBusRisk++;
            }
        }
        s.uniqueAdvisories = advisories.size();
        advisorySev.values().forEach(v -> s.advisorySeverityCounts.merge(v, 1, Integer::sum));
        s.avgBusRisk = riskWeight > 0 ? Math.round(riskSum / riskWeight * 10) / 10.0 : null;

        double vulnComponent = 100 * (1 - Math.exp(-vulnPts / 60.0));
        double score;
        if (s.avgBusRisk != null) {
            score = 0.7 * vulnComponent + 0.3 * s.avgBusRisk;
            s.scoreExplanation.add("70% vulnerability load: " + Math.round(vulnComponent) + "/100 (critical=30, high=15, medium=6, low=2, unscored=4 points per vulnerable package; dev-only packages count half; saturating curve)");
            s.scoreExplanation.add("30% maintainer / bus-factor risk: " + s.avgBusRisk + "/100 average over " + s.riskAvailable + " packages with data (direct dependencies weighted 2x)");
        } else {
            score = vulnComponent;
            s.scoreExplanation.add("100% vulnerability load: " + Math.round(vulnComponent) + "/100 — no maintainer data was available, so bus-factor risk is excluded rather than guessed");
        }
        if (s.notScanned > 0) s.scoreExplanation.add(s.notScanned + " packages could not be scanned (unresolved version or unsupported ecosystem) and do not contribute");
        s.overallScore = (int) Math.round(score);
        s.grade = score < 15 ? "A" : score < 30 ? "B" : score < 50 ? "C" : score < 70 ? "D" : "F";
        s.omittedPackages = omitted;
        s.truncated = omitted > 0;
        return s;
    }
}
