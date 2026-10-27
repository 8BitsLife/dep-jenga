package dev.depjenga.analysis;

import dev.depjenga.model.Model.AnalysisResult;
import dev.depjenga.model.Model.PackageNode;
import dev.depjenga.model.Model.Summary;
import dev.depjenga.model.Model.Vuln;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Repository-level "collapse risk": a transparent blend of vulnerability load and bus-factor risk. */
final class Scoring {
    private Scoring() {}

    private static final Map<String, Integer> WEIGHT = Map.of("CRITICAL", 30, "HIGH", 15, "MEDIUM", 6, "LOW", 2, "UNKNOWN", 5);
    /** Each further vulnerable package counts a little less: 40 medium findings are not 40x one. */
    private static final double DECAY = 0.93;

    static Summary summarize(AnalysisResult r, int omitted) {
        Summary s = new Summary();
        for (String k : List.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN", "NONE", "NOT_SCANNED")) s.severityCounts.put(k, 0);
        for (String k : List.of("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")) s.advisorySeverityCounts.put(k, 0);
        Set<String> advisories = new HashSet<>();
        Map<String, String> advisorySev = new HashMap<>();
        List<Double> vulnWeights = new ArrayList<>();
        boolean unfixedRuntimeCritical = false;
        double riskSum = 0, riskWeight = 0;
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
                for (Vuln v : n.vulns) {
                    advisories.add(v.id);
                    advisorySev.putIfAbsent(v.id, v.severity);
                }
                boolean fixable = n.fix != null && n.fix.recommendedVersion != null;
                if (fixable) s.fixable++;
                else s.unfixable++;
                // dev-only code never ships, a published fix is one bump away, and a direct dependency is the most exposed
                vulnWeights.add(WEIGHT.getOrDefault(n.severity, 5) * (n.dev ? 0.35 : 1.0) * (fixable ? 0.7 : 1.0) * (n.direct ? 1.0 : 0.85));
                if (!n.dev && !fixable && "CRITICAL".equals(n.severity)) unfixedRuntimeCritical = true;
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

        vulnWeights.sort(Comparator.reverseOrder());
        double vulnPts = 0;
        for (int i = 0; i < vulnWeights.size(); i++) vulnPts += vulnWeights.get(i) * Math.pow(DECAY, i);
        // bigger trees get a little more headroom; a handful of findings means less in 600 packages than in 20
        double headroom = 60 * (1 + 0.5 * Math.log10(Math.max(1, s.totalPackages / 50.0)));
        double vulnComponent = 100 * (1 - Math.exp(-vulnPts / headroom));
        // most healthy ecosystems average 20-40 bus-factor risk, so only the part above 20 counts
        Double busComponent = s.avgBusRisk == null ? null : 100 * Math.min(1, Math.max(0, (s.avgBusRisk - 20) / 60));
        double score;
        String vulnLine = "vulnerability load " + Math.round(vulnComponent) + "/100: critical=30, high=15, medium=6, low=2, unscored=5 points per vulnerable package, x0.35 if dev-only, x0.7 if a fix exists, x0.85 if transitive; each further package counts 7% less";
        if (busComponent != null) {
            score = 0.75 * vulnComponent + 0.25 * busComponent;
            s.scoreExplanation.add("75% " + vulnLine);
            s.scoreExplanation.add("25% maintainer risk " + Math.round(busComponent) + "/100: average bus-factor risk " + s.avgBusRisk + " over " + s.riskAvailable + " packages (direct 2x), counted above a baseline of 20");
        } else {
            score = vulnComponent;
            s.scoreExplanation.add("100% " + vulnLine + " (no maintainer data, so bus-factor risk is excluded rather than guessed)");
        }
        if (unfixedRuntimeCritical && score < 47) {
            score = 47;
            s.scoreExplanation.add("Raised to grade D: a runtime dependency has a critical advisory with no fixed version");
        }
        if (s.notScanned > 0) s.scoreExplanation.add(s.notScanned + " packages could not be scanned (unresolved version or unsupported ecosystem) and do not contribute");
        s.overallScore = (int) Math.round(score);
        s.grade = score < 15 ? "A" : score < 30 ? "B" : score < 47 ? "C" : score < 68 ? "D" : "F";
        s.omittedPackages = omitted;
        s.truncated = omitted > 0;
        return s;
    }
}
