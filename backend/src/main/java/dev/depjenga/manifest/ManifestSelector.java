package dev.depjenga.manifest;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Picks which manifest files to analyze from a repository tree. Files are grouped by directory into
 * "units" (e.g. package.json + package-lock.json), lockfiles win over plain manifests, and vendored /
 * test / example directories are ignored.
 */
public final class ManifestSelector {
    private ManifestSelector() {}

    /** A group of files in one directory that together describe one ecosystem's dependencies. */
    public record Unit(String dir, String ecosystem, String primary, List<String> files, boolean lockfile) {}

    public static final List<String> ROOT_PROBES = List.of(
            "package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
            "requirements.txt", "pyproject.toml", "poetry.lock", "Pipfile.lock",
            "go.mod", "Cargo.toml", "Cargo.lock", "Gemfile.lock", "composer.json", "composer.lock",
            "pom.xml", "build.gradle", "build.gradle.kts");

    private static final Set<String> SKIP_SEGMENTS = Set.of(
            "node_modules", "vendor", "third_party", "third-party", "test", "tests", "__tests__", "testdata", "test-data",
            "fixtures", "fixture", "__fixtures__", "examples", "example", "samples", "sample", "e2e", "benchmark", "benchmarks",
            ".yarn", ".github", "bower_components", "dist", "build", "target", "site-packages", "demo", "demos", "templates", "template");

    private static boolean skipped(String path) {
        String[] segs = path.split("/");
        for (int i = 0; i < segs.length - 1; i++) if (SKIP_SEGMENTS.contains(segs[i].toLowerCase())) return true;
        return false;
    }

    private static boolean isRequirements(String base) {
        return base.matches("(?i)requirements([-_.][\\w\\-.]*)?\\.txt");
    }

    public static List<Unit> select(List<String> paths, int max) {
        Map<String, Map<String, String>> byDir = new TreeMap<>();
        for (String path : paths) {
            if (skipped(path)) continue;
            int slash = path.lastIndexOf('/');
            String dir = slash < 0 ? "" : path.substring(0, slash);
            String base = slash < 0 ? path : path.substring(slash + 1);
            if (ROOT_PROBES.contains(base) || isRequirements(base)) {
                byDir.computeIfAbsent(dir, d -> new LinkedHashMap<>()).put(base, path);
            }
            // requirements/*.txt convention
            if (dir.endsWith("requirements") && base.endsWith(".txt")) {
                byDir.computeIfAbsent(dir, d -> new LinkedHashMap<>()).put("requirements:" + base, path);
            }
        }
        List<Unit> units = new ArrayList<>();
        List<String> npmLockDirs = new ArrayList<>(), cargoLockDirs = new ArrayList<>();
        for (Map.Entry<String, Map<String, String>> e : byDir.entrySet()) {
            Map<String, String> f = e.getValue();
            if (f.containsKey("package-lock.json") || f.containsKey("npm-shrinkwrap.json") || f.containsKey("yarn.lock") || f.containsKey("pnpm-lock.yaml")) npmLockDirs.add(e.getKey());
            if (f.containsKey("Cargo.lock")) cargoLockDirs.add(e.getKey());
        }
        for (Map.Entry<String, Map<String, String>> e : byDir.entrySet()) {
            String dir = e.getKey();
            Map<String, String> f = e.getValue();
            // npm
            String pj = f.get("package.json");
            String lock = f.containsKey("package-lock.json") ? f.get("package-lock.json")
                    : f.containsKey("npm-shrinkwrap.json") ? f.get("npm-shrinkwrap.json")
                    : f.get("yarn.lock");
            if (lock != null) {
                List<String> files = new ArrayList<>(List.of(lock));
                if (pj != null) files.add(pj);
                units.add(new Unit(dir, "npm", lock, files, true));
            } else if (pj != null && !coveredByAncestor(dir, npmLockDirs)) {
                List<String> files = new ArrayList<>(List.of(pj));
                if (f.containsKey("pnpm-lock.yaml")) files.add(f.get("pnpm-lock.yaml"));
                units.add(new Unit(dir, "npm", pj, files, false));
            }
            // Python
            if (f.containsKey("poetry.lock")) {
                List<String> files = new ArrayList<>(List.of(f.get("poetry.lock")));
                if (f.containsKey("pyproject.toml")) files.add(f.get("pyproject.toml"));
                units.add(new Unit(dir, "PyPI", f.get("poetry.lock"), files, true));
            } else if (f.containsKey("Pipfile.lock")) {
                units.add(new Unit(dir, "PyPI", f.get("Pipfile.lock"), List.of(f.get("Pipfile.lock")), true));
            } else {
                List<String> reqs = f.entrySet().stream()
                        .filter(x -> isRequirements(x.getKey()) || x.getKey().startsWith("requirements:"))
                        .map(Map.Entry::getValue).sorted(Comparator.comparing(String::length)).toList();
                if (!reqs.isEmpty()) units.add(new Unit(dir, "PyPI", reqs.get(0), reqs.stream().limit(4).toList(), false));
                else if (f.containsKey("pyproject.toml")) units.add(new Unit(dir, "PyPI", f.get("pyproject.toml"), List.of(f.get("pyproject.toml")), false));
            }
            // Go
            if (f.containsKey("go.mod")) units.add(new Unit(dir, "Go", f.get("go.mod"), List.of(f.get("go.mod")), true));
            // Rust
            if (f.containsKey("Cargo.lock")) units.add(new Unit(dir, "crates.io", f.get("Cargo.lock"), List.of(f.get("Cargo.lock")), true));
            else if (f.containsKey("Cargo.toml") && !coveredByAncestor(dir, cargoLockDirs)) units.add(new Unit(dir, "crates.io", f.get("Cargo.toml"), List.of(f.get("Cargo.toml")), false));
            // Ruby
            if (f.containsKey("Gemfile.lock")) units.add(new Unit(dir, "RubyGems", f.get("Gemfile.lock"), List.of(f.get("Gemfile.lock")), true));
            // PHP
            if (f.containsKey("composer.lock")) {
                List<String> files = new ArrayList<>(List.of(f.get("composer.lock")));
                if (f.containsKey("composer.json")) files.add(f.get("composer.json"));
                units.add(new Unit(dir, "Packagist", f.get("composer.lock"), files, true));
            }
            // JVM
            if (f.containsKey("pom.xml")) units.add(new Unit(dir, "Maven", f.get("pom.xml"), List.of(f.get("pom.xml")), false));
            else if (f.containsKey("build.gradle")) units.add(new Unit(dir, "Maven", f.get("build.gradle"), List.of(f.get("build.gradle")), false));
            else if (f.containsKey("build.gradle.kts")) units.add(new Unit(dir, "Maven", f.get("build.gradle.kts"), List.of(f.get("build.gradle.kts")), false));
        }
        units.sort(Comparator.comparingInt((Unit u) -> u.dir().isEmpty() ? 0 : u.dir().split("/").length)
                .thenComparing(u -> !u.lockfile())
                .thenComparing(Unit::dir));
        return units.size() > max ? units.subList(0, max) : units;
    }

    private static boolean coveredByAncestor(String dir, List<String> lockDirs) {
        for (String l : lockDirs) {
            if (l.equals(dir)) continue;
            if (l.isEmpty() || dir.startsWith(l + "/")) return true;
        }
        return false;
    }
}
