package dev.depjenga.versions;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Version comparison and range resolution. Implements npm/Cargo semver ranges and a practical subset of
 * PEP 440 specifiers. Anything it cannot interpret returns null so the caller marks the version "unresolved"
 * rather than guessing.
 */
public final class Versions {
    private Versions() {}

    // ---------------------------------------------------------------- generic comparison

    /** Ecosystem-agnostic ordering: numeric segments compare numerically, pre-release tags sort before releases. */
    public static int compare(String a, String b) {
        String[] pa = norm(a).split("[.\\-+_]");
        String[] pb = norm(b).split("[.\\-+_]");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            String x = i < pa.length ? pa[i] : null;
            String y = i < pb.length ? pb[i] : null;
            if (x == null) return isNum(y) ? (Long.parseLong(y) == 0 ? 0 : -1) : 1;
            if (y == null) return isNum(x) ? (Long.parseLong(x) == 0 ? 0 : 1) : -1;
            boolean nx = isNum(x), ny = isNum(y);
            int c;
            if (nx && ny) c = Long.compare(Long.parseLong(x), Long.parseLong(y));
            else if (nx) c = 1;
            else if (ny) c = -1;
            else c = x.compareToIgnoreCase(y);
            if (c != 0) return c;
        }
        return 0;
    }

    private static String norm(String v) {
        String s = v.trim();
        if (s.startsWith("v") || s.startsWith("V")) s = s.substring(1);
        return s;
    }

    private static boolean isNum(String s) {
        if (s == null || s.isEmpty() || s.length() > 18) return false;
        for (int i = 0; i < s.length(); i++) if (!Character.isDigit(s.charAt(i))) return false;
        return true;
    }

    public static boolean isPrerelease(String v) {
        String s = norm(v).toLowerCase();
        return s.matches(".*\\d[-.]?(alpha|beta|rc|pre|dev|a|b|c|canary|next|nightly|snapshot|m)\\.?\\d*.*") || s.contains("-");
    }

    // ---------------------------------------------------------------- semver (npm, Cargo)

    record SV(int major, int minor, int patch, String pre) implements Comparable<SV> {
        public int compareTo(SV o) {
            if (major != o.major) return Integer.compare(major, o.major);
            if (minor != o.minor) return Integer.compare(minor, o.minor);
            if (patch != o.patch) return Integer.compare(patch, o.patch);
            if (pre.isEmpty() && o.pre.isEmpty()) return 0;
            if (pre.isEmpty()) return 1;
            if (o.pre.isEmpty()) return -1;
            return Versions.compare(pre, o.pre);
        }
    }

    private static final Pattern FULL = Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.\\-]+))?(?:\\+[0-9A-Za-z.\\-]+)?$");
    private static final Pattern PARTIAL = Pattern.compile("^v?(\\d+|[xX*])(?:\\.(\\d+|[xX*]))?(?:\\.(\\d+|[xX*]))?(?:-([0-9A-Za-z.\\-]+))?(?:\\+[0-9A-Za-z.\\-]+)?$");

    static SV parseSv(String v) {
        Matcher m = FULL.matcher(v.trim());
        if (!m.matches()) return null;
        try {
            return new SV(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)), m.group(4) == null ? "" : m.group(4));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** One comparator: lo (inclusive/exclusive) and hi (exclusive/inclusive). Nulls are unbounded. */
    record Bound(SV lo, boolean loInc, SV hi, boolean hiInc) {
        boolean test(SV v) {
            if (lo != null) {
                int c = v.compareTo(lo);
                if (c < 0 || (c == 0 && !loInc)) return false;
            }
            if (hi != null) {
                int c = v.compareTo(hi);
                if (c > 0 || (c == 0 && !hiInc)) return false;
            }
            return true;
        }
    }

    private static boolean wild(String s) {
        return s == null || s.equals("x") || s.equals("X") || s.equals("*");
    }

    /** Parses a semver range into OR-of-AND bounds. bareIsCaret=true gives Cargo semantics. */
    static List<List<Bound>> parseRange(String range, boolean bareIsCaret) {
        String r = range.trim();
        if (r.isEmpty() || r.equals("*") || r.equalsIgnoreCase("x") || r.equals("latest")) {
            return List.of(List.of(new Bound(null, true, null, true)));
        }
        List<List<Bound>> out = new ArrayList<>();
        for (String set : r.split("\\|\\|")) {
            set = set.trim().replace(",", " ");
            List<Bound> and = new ArrayList<>();
            Matcher hy = Pattern.compile("^(\\S+)\\s+-\\s+(\\S+)$").matcher(set);
            if (hy.matches()) {
                Bound a = comparator(">=" + hy.group(1), false), b = comparator("<=" + hy.group(2), false);
                if (a == null || b == null) return null;
                and.add(a);
                and.add(b);
            } else {
                // join operators separated from their versions by spaces: ">= 1.2" -> ">=1.2"
                set = set.replaceAll("(>=|<=|>|<|=|\\^|~>?)\\s+", "$1");
                for (String tok : set.trim().split("\\s+")) {
                    if (tok.isEmpty()) continue;
                    Bound b = comparator(tok, bareIsCaret);
                    if (b == null) return null;
                    and.add(b);
                }
            }
            out.add(and);
        }
        return out;
    }

    private static Bound comparator(String tok, boolean bareIsCaret) {
        String op;
        if (tok.startsWith(">=") || tok.startsWith("<=")) op = tok.substring(0, 2);
        else if (tok.startsWith("~>")) op = "~";
        else if (tok.startsWith(">") || tok.startsWith("<") || tok.startsWith("^") || tok.startsWith("~") || tok.startsWith("=")) op = tok.substring(0, 1);
        else op = "";
        String ver = tok.substring(op.equals("~") && tok.startsWith("~>") ? 2 : op.length());
        if (op.equals("") && bareIsCaret) op = "^";
        Matcher m = PARTIAL.matcher(ver);
        if (!m.matches()) return null;
        String g1 = m.group(1), g2 = m.group(2), g3 = m.group(3);
        String pre = m.group(4) == null ? "" : m.group(4);
        if (wild(g1)) return new Bound(null, true, null, true);
        int maj = Integer.parseInt(g1);
        boolean minW = wild(g2), patW = wild(g3);
        int min = minW ? 0 : Integer.parseInt(g2);
        int pat = patW ? 0 : Integer.parseInt(g3);
        SV base = new SV(maj, min, pat, pre);
        switch (op) {
            case "^": {
                SV hi;
                if (maj > 0 || minW) hi = new SV(maj + 1, 0, 0, "");
                else if (min > 0 || patW) hi = new SV(0, min + 1, 0, "");
                else hi = new SV(0, 0, pat + 1, "");
                return new Bound(base, true, hi, false);
            }
            case "~": {
                SV hi = minW ? new SV(maj + 1, 0, 0, "") : new SV(maj, min + 1, 0, "");
                return new Bound(base, true, hi, false);
            }
            case ">=":
                return new Bound(base, true, null, true);
            case ">": {
                if (minW) return new Bound(new SV(maj + 1, 0, 0, ""), true, null, true);
                if (patW) return new Bound(new SV(maj, min + 1, 0, ""), true, null, true);
                return new Bound(base, false, null, true);
            }
            case "<":
                return new Bound(null, true, base, false);
            case "<=": {
                if (minW) return new Bound(null, true, new SV(maj + 1, 0, 0, ""), false);
                if (patW) return new Bound(null, true, new SV(maj, min + 1, 0, ""), false);
                return new Bound(null, true, base, true);
            }
            default: { // "=" or bare
                if (minW) return new Bound(base, true, new SV(maj + 1, 0, 0, ""), false);
                if (patW) return new Bound(base, true, new SV(maj, min + 1, 0, ""), false);
                return new Bound(base, true, base, true);
            }
        }
    }

    /** Highest stable version in `available` satisfying the semver range, or null. */
    public static String maxSatisfyingSemver(List<String> available, String range, boolean bareIsCaret) {
        List<List<Bound>> sets = parseRange(range, bareIsCaret);
        if (sets == null) return null;
        boolean allowPre = range.contains("-");
        SV best = null;
        String bestRaw = null;
        for (String raw : available) {
            SV v = parseSv(raw);
            if (v == null || (!v.pre().isEmpty() && !allowPre)) continue;
            boolean ok = false;
            for (List<Bound> and : sets) {
                boolean all = true;
                for (Bound b : and) if (!b.test(v)) { all = false; break; }
                if (all) { ok = true; break; }
            }
            if (ok && (best == null || v.compareTo(best) > 0)) {
                best = v;
                bestRaw = raw;
            }
        }
        return bestRaw;
    }

    // ---------------------------------------------------------------- PEP 440 (subset)

    /** Highest stable version satisfying comma-separated PEP 440 specifiers; null if unparseable or none match. */
    public static String maxSatisfyingPep440(List<String> available, String spec) {
        String s = spec.trim();
        if (s.startsWith("^") || (s.startsWith("~") && !s.startsWith("~="))) {
            return maxSatisfyingSemver(available.stream().map(Versions::padSemver).toList(), s, false) == null ? null
                    : unpad(available, maxSatisfyingSemver(available.stream().map(Versions::padSemver).toList(), s, false));
        }
        List<String[]> clauses = new ArrayList<>();
        if (!s.isEmpty() && !s.equals("*")) {
            for (String c : s.split(",")) {
                Matcher m = Pattern.compile("^\\s*(===|==|!=|~=|>=|<=|>|<)\\s*([^\\s]+)\\s*$").matcher(c);
                if (!m.matches()) return null;
                clauses.add(new String[] {m.group(1), m.group(2)});
            }
        }
        String best = null;
        for (String v : available) {
            if (isPrerelease(v) || v.contains("dev")) continue;
            boolean ok = true;
            for (String[] c : clauses) {
                if (!pepTest(v, c[0], c[1])) { ok = false; break; }
            }
            if (ok && (best == null || compare(v, best) > 0)) best = v;
        }
        return best;
    }

    private static String padSemver(String v) {
        String[] p = v.split("\\.");
        if (p.length == 1) return v + ".0.0";
        if (p.length == 2) return v + ".0";
        return v;
    }

    private static String unpad(List<String> available, String padded) {
        for (String v : available) if (padSemver(v).equals(padded)) return v;
        return padded;
    }

    private static boolean pepTest(String v, String op, String target) {
        if (target.endsWith(".*")) {
            String prefix = target.substring(0, target.length() - 2);
            boolean match = v.equals(prefix) || v.startsWith(prefix + ".");
            return op.equals("!=") != match;
        }
        int c = compare(v, target);
        return switch (op) {
            case "==", "===" -> c == 0;
            case "!=" -> c != 0;
            case ">=" -> c >= 0;
            case "<=" -> c <= 0;
            case ">" -> c > 0;
            case "<" -> c < 0;
            case "~=" -> {
                String[] parts = target.split("\\.");
                if (parts.length < 2) yield c >= 0;
                String prefix = String.join(".", java.util.Arrays.copyOf(parts, parts.length - 1));
                yield c >= 0 && (v.equals(prefix) || v.startsWith(prefix + "."));
            }
            default -> false;
        };
    }
}
