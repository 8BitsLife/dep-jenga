package dev.depjenga.versions;

import java.util.HashMap;
import java.util.Map;

/** CVSS v3.x base score from a vector string (FIRST CVSS v3.1 specification, section 7). */
public final class Cvss {
    private Cvss() {}

    public static Double v3BaseScore(String vector) {
        if (vector == null || !vector.startsWith("CVSS:3")) return null;
        Map<String, String> m = new HashMap<>();
        for (String part : vector.split("/")) {
            String[] kv = part.split(":");
            if (kv.length == 2) m.put(kv[0], kv[1]);
        }
        try {
            boolean changed = "C".equals(m.get("S"));
            double av = switch (m.get("AV")) { case "N" -> 0.85; case "A" -> 0.62; case "L" -> 0.55; case "P" -> 0.2; default -> throw new IllegalArgumentException(); };
            double ac = switch (m.get("AC")) { case "L" -> 0.77; case "H" -> 0.44; default -> throw new IllegalArgumentException(); };
            double pr = switch (m.get("PR")) { case "N" -> 0.85; case "L" -> changed ? 0.68 : 0.62; case "H" -> changed ? 0.5 : 0.27; default -> throw new IllegalArgumentException(); };
            double ui = switch (m.get("UI")) { case "N" -> 0.85; case "R" -> 0.62; default -> throw new IllegalArgumentException(); };
            double c = cia(m.get("C")), i = cia(m.get("I")), a = cia(m.get("A"));
            double iss = 1 - (1 - c) * (1 - i) * (1 - a);
            double impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
            double expl = 8.22 * av * ac * pr * ui;
            if (impact <= 0) return 0.0;
            return changed ? roundUp(Math.min(1.08 * (impact + expl), 10)) : roundUp(Math.min(impact + expl, 10));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static double cia(String v) {
        return switch (v) { case "H" -> 0.56; case "L" -> 0.22; case "N" -> 0.0; default -> throw new IllegalArgumentException(); };
    }

    private static double roundUp(double x) {
        long i = Math.round(x * 100000);
        if (i % 10000 == 0) return i / 100000.0;
        return (Math.floor(i / 10000.0) + 1) / 10.0;
    }

    public static String band(double score) {
        if (score >= 9.0) return "CRITICAL";
        if (score >= 7.0) return "HIGH";
        if (score >= 4.0) return "MEDIUM";
        if (score > 0) return "LOW";
        return "NONE";
    }
}
