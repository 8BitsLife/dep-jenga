package dev.depjenga.analysis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.depjenga.http.TtlCache;
import dev.depjenga.manifest.ManifestSelector;
import dev.depjenga.manifest.ManifestSelector.Unit;
import dev.depjenga.manifest.Parsed;
import dev.depjenga.manifest.Parsers;
import dev.depjenga.model.Model.AnalysisResult;
import dev.depjenga.model.Model.Edge;
import dev.depjenga.model.Model.ManifestInfo;
import dev.depjenga.model.Model.PackageNode;
import dev.depjenga.model.Model.RepoInfo;
import dev.depjenga.sources.DepsDevClient;
import dev.depjenga.sources.GitHubClient;
import dev.depjenga.sources.GitHubClient.RepoRef;
import dev.depjenga.sources.GitHubClient.Tree;
import dev.depjenga.sources.NpmRegistryClient;
import dev.depjenga.sources.OsvClient;
import dev.depjenga.versions.Versions;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AnalysisService {
    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
    public static final String ROOT = "ROOT";

    public interface Progress {
        void emit(String stage, String message, int pct);
    }

    private final GitHubClient gh;
    private final DepsDevClient depsDev;
    private final VulnerabilityService vulns;
    private final RiskService risk;
    private final ObjectMapper om;
    private final int maxPackages, maxManifests;
    private final TtlCache<AnalysisResult> results = new TtlCache<>(20 * 60_000L, 200);

    public AnalysisService(GitHubClient gh, DepsDevClient depsDev,
                           VulnerabilityService vulns, RiskService risk, ObjectMapper om,
                           @Value("${depjenga.max-packages:600}") int maxPackages,
                           @Value("${depjenga.max-manifests:10}") int maxManifests) {
        this.gh = gh;
        this.depsDev = depsDev;
        this.vulns = vulns;
        this.risk = risk;
        this.om = om;
        this.maxPackages = maxPackages;
        this.maxManifests = maxManifests;
    }

    public AnalysisResult analyze(String input, boolean fresh, Progress progress) {
        long t0 = System.currentTimeMillis();
        RepoRef ref = GitHubClient.parse(input);
        SourceLog sl = new SourceLog();
        sl.register(GitHubClient.API, "https://docs.github.com/en/rest");
        sl.register(GitHubClient.RAW, "https://raw.githubusercontent.com");
        sl.register(GitHubClient.MIRROR, "https://www.jsdelivr.com/docs/data.jsdelivr.com");
        sl.register(DepsDevClient.NAME, "https://deps.dev");
        sl.register(OsvClient.NAME, "https://osv.dev");
        sl.register(GitHubClient.ADVISORIES, "https://github.com/advisories");
        sl.register(NpmRegistryClient.NAME, "https://registry.npmjs.org");

        progress.emit("repo", "Locating " + ref.owner() + "/" + ref.repo() + " on GitHub", 2);
        JsonNode meta = gh.repo(ref, sl);
        RepoInfo repo = repoInfo(ref, meta);
        String branch = ref.ref() != null ? ref.ref() : meta != null ? meta.path("default_branch").asText("HEAD") : "HEAD";
        repo.ref = branch;
        String cacheKey = (repo.fullName + "@" + branch).toLowerCase();
        if (!fresh) {
            Optional<AnalysisResult> hit = results.get(cacheKey);
            if (hit != null && hit.isPresent()) {
                progress.emit("done", "Loaded a cached analysis from the last 20 minutes", 100);
                return hit.get();
            }
        }

        AnalysisResult result = new AnalysisResult();
        result.repo = repo;
        result.rootId = ROOT;
        if (meta == null) result.notes.add("GitHub repository metadata was unavailable (API rate limit?) — stars, description and license are not shown.");

        // ------------------------------------------------------------------ discover manifests
        progress.emit("tree", "Scanning the repository tree for dependency manifests", 6);
        Tree tree = gh.tree(ref, branch, sl);
        if (tree == null) {
            tree = gh.mirrorTree(ref, branch, sl);
            if (tree != null) result.notes.add("The GitHub tree API was unavailable (rate limit?), so the file listing came from jsDelivr's GitHub mirror, which can lag a recent push by a few hours.");
        }
        Map<String, String> files = new ConcurrentHashMap<>();
        List<String> paths;
        boolean rootOnly = tree == null;
        if (tree != null) {
            paths = tree.entries().stream().filter(e -> e.size() < 25_000_000).map(GitHubClient.TreeEntry::path).toList();
            if (tree.truncated()) result.notes.add("The repository tree is very large and GitHub truncated the listing; some nested manifests may be missing.");
        } else {
            result.notes.add("Neither the GitHub tree API nor the jsDelivr mirror was available, so only root-level manifests were probed directly.");
            List<String> found = java.util.Collections.synchronizedList(new ArrayList<>());
            parallel(ManifestSelector.ROOT_PROBES, name -> {
                String body = gh.raw(ref, branch, name, sl);
                if (body != null) {
                    files.put(name, body);
                    found.add(name);
                }
            });
            paths = found;
        }
        List<Unit> units = ManifestSelector.select(paths, maxManifests);
        if (units.isEmpty() && rootOnly) {
            throw new AnalysisException("GitHub's API rate limit was reached and the file-listing mirror was unavailable, so only the root of "
                    + repo.fullName + " could be checked, and it has no dependency manifests. Nested manifests (for example frontend/package.json) "
                    + "need the file listing: add a GitHub token, or try again once the hourly limit resets.");
        }
        if (units.isEmpty()) {
            throw new AnalysisException("No supported dependency manifests were found in " + repo.fullName
                    + ". Supported: package-lock.json, yarn.lock, package.json, requirements*.txt, pyproject.toml, poetry.lock, Pipfile.lock, go.mod, Cargo.lock, Cargo.toml, Gemfile.lock, composer.lock, pom.xml, build.gradle.");
        }
        progress.emit("manifests", "Found " + units.size() + " manifest group(s): "
                + String.join(", ", units.stream().map(Unit::primary).limit(4).toList()) + (units.size() > 4 ? "…" : ""), 10);

        Set<String> needed = new LinkedHashSet<>();
        units.forEach(u -> needed.addAll(u.files()));
        needed.removeAll(files.keySet());
        parallel(needed, path -> {
            String body = gh.raw(ref, branch, path, sl);
            if (body != null) files.put(path, body);
        });

        // ------------------------------------------------------------------ parse
        List<Parsed> parsedList = new ArrayList<>();
        for (Unit u : units) {
            try {
                Parsed p = parse(u, files);
                if (p != null) parsedList.add(p);
            } catch (Exception e) {
                result.notes.add("Could not parse " + u.primary() + ": " + e.getMessage());
            }
        }
        int declared = parsedList.stream().mapToInt(p -> p.nodes.size()).sum();
        progress.emit("parse", "Parsed " + declared + " dependency entries from " + parsedList.size() + " manifest(s)", 16);

        // ------------------------------------------------------------------ resolve ranges (manifests without lockfiles)
        List<Parsed.Dep> toResolve = new ArrayList<>();
        Map<Parsed.Dep, String> depEco = new HashMap<>();
        for (Parsed p : parsedList) {
            for (Parsed.Dep d : p.nodes.values()) {
                if (d.version == null && d.range != null && DepsDevClient.systemFor(p.ecosystem) != null) {
                    toResolve.add(d);
                    depEco.put(d, p.ecosystem);
                }
            }
        }
        if (!toResolve.isEmpty()) {
            progress.emit("resolve", "Resolving " + toResolve.size() + " version ranges against registry data (deps.dev)", 20);
            parallel(toResolve, d -> resolveRange(d, depEco.get(d), sl));
        }

        // ------------------------------------------------------------------ build graph
        Graph g = new Graph();
        Map<String, JsonNode> expansions = new ConcurrentHashMap<>();
        List<Object[]> expandTargets = new ArrayList<>();
        for (Parsed p : parsedList) {
            String system = DepsDevClient.systemFor(p.ecosystem);
            if (p.complete || system == null || !DepsDevClient.supportsResolution(system)) continue;
            for (String key : p.direct) {
                Parsed.Dep d = p.nodes.get(key);
                if (d != null && d.version != null && expandTargets.size() < 120) expandTargets.add(new Object[] {system, d});
            }
        }
        if (!expandTargets.isEmpty()) {
            progress.emit("expand", "Expanding the transitive tree of " + expandTargets.size() + " direct dependencies via the deps.dev resolver", 26);
            parallel(expandTargets, t -> {
                Parsed.Dep d = (Parsed.Dep) t[1];
                String system = (String) t[0];
                JsonNode deps = depsDev.getDependencies(system, ddName(system, d.name), d.version, sl);
                if (deps != null && deps.path("nodes").size() > 0) expansions.put(system + "|" + d.name + "|" + d.version, deps);
            });
        }

        for (Parsed p : parsedList) {
            ManifestInfo mi = new ManifestInfo();
            mi.path = p.path;
            mi.ecosystem = p.ecosystem;
            mi.kind = p.kind;
            mi.parser = p.parser;
            mi.notes.addAll(p.notes);
            String system = DepsDevClient.systemFor(p.ecosystem);
            Map<String, String> keyToId = new HashMap<>();
            for (Map.Entry<String, Parsed.Dep> e : p.nodes.entrySet()) {
                Parsed.Dep d = e.getValue();
                String source = switch (d.source) {
                    case "lockfile" -> "lockfile";
                    case "pinned" -> "pinned";
                    default -> d.version != null ? "resolved-range" : "unresolved";
                };
                PackageNode n = g.node(p.ecosystem, system, d.name, d.version, source, d.range, p.path, d.dev);
                keyToId.put(e.getKey(), n.id);
            }
            for (String[] edge : p.edges) {
                String a = keyToId.get(edge[0]), b = keyToId.get(edge[1]);
                if (a != null && b != null) g.edge(a, b);
            }
            for (String key : p.direct) {
                String id = keyToId.get(key);
                if (id == null) continue;
                g.nodes.get(id).direct = true;
                g.edge(ROOT, id);
                Parsed.Dep d = p.nodes.get(key);
                JsonNode exp = d.version == null ? null : expansions.get(system + "|" + d.name + "|" + d.version);
                if (exp != null) mergeExpansion(g, exp, id, p, d.dev);
            }
            mi.packages = p.nodes.size();
            if (!p.complete && p.ecosystem != null && system != null && DepsDevClient.supportsResolution(system)) {
                mi.notes.add("No lockfile: transitive versions come from the deps.dev resolver and may differ from what you actually install");
            }
            result.manifests.add(mi);
        }
        if (g.nodes.isEmpty()) throw new AnalysisException("Manifests were found but no registry dependencies could be extracted from them.");

        // orphans (e.g. go.mod indirect modules, Pipfile.lock) hang off the root
        Set<String> hasParent = new HashSet<>();
        g.edges.forEach(e -> hasParent.add(e.to));
        for (PackageNode n : g.nodes.values()) if (!hasParent.contains(n.id)) g.edge(ROOT, n.id);

        // ------------------------------------------------------------------ depth + cap
        computeDepth(g);
        int total = g.nodes.size();
        if (total > maxPackages) {
            List<PackageNode> sorted = new ArrayList<>(g.nodes.values());
            sorted.sort(Comparator.comparingInt((PackageNode n) -> n.depth < 0 ? 99 : n.depth).thenComparing(n -> n.dev));
            Set<String> keep = new HashSet<>();
            sorted.stream().limit(maxPackages).forEach(n -> keep.add(n.id));
            g.nodes.keySet().retainAll(keep);
            g.edges.removeIf(e -> !(e.from.equals(ROOT) || keep.contains(e.from)) || !keep.contains(e.to));
            result.notes.add("This repository has " + total + " packages; the " + maxPackages + " closest to your code were analyzed (" + (total - maxPackages) + " deeper packages omitted).");
        }
        computeCounts(g);
        result.packages.addAll(g.nodes.values());
        result.edges.addAll(g.edges);
        progress.emit("graph", "Dependency graph: " + g.nodes.size() + " packages, " + g.edges.size() + " edges", 34);

        // ------------------------------------------------------------------ vulnerabilities
        vulns.scan(result.packages, sl, progress);

        // ------------------------------------------------------------------ maintainer / bus factor
        risk.enrich(result.packages, sl, progress);

        // ------------------------------------------------------------------ remediation + summary
        progress.emit("remediate", "Computing remediation paths from published fixed versions", 94);
        vulns.remediate(result.packages, g.edges, sl);
        result.summary = Scoring.summarize(result, total > maxPackages ? total - maxPackages : 0);
        result.sources = sl.snapshot();
        result.generatedAt = Instant.now().toString();
        result.durationMs = System.currentTimeMillis() - t0;
        results.put(cacheKey, result);
        progress.emit("done", "Analysis complete in " + (result.durationMs / 100) / 10.0 + "s", 100);
        return result;
    }

    // ===================================================================== helpers

    private RepoInfo repoInfo(RepoRef ref, JsonNode meta) {
        RepoInfo r = new RepoInfo();
        r.owner = ref.owner();
        r.name = ref.repo();
        r.fullName = ref.owner() + "/" + ref.repo();
        r.url = "https://github.com/" + r.fullName;
        if (meta != null) {
            r.metadataAvailable = true;
            r.fullName = meta.path("full_name").asText(r.fullName);
            r.description = meta.path("description").asText(null);
            r.defaultBranch = meta.path("default_branch").asText(null);
            r.language = meta.path("language").asText(null);
            r.license = meta.path("license").path("spdx_id").asText(null);
            r.pushedAt = meta.path("pushed_at").asText(null);
            r.stars = meta.path("stargazers_count").asInt();
            r.forks = meta.path("forks_count").asInt();
            r.openIssues = meta.path("open_issues_count").asInt();
            r.archived = meta.path("archived").asBoolean(false);
        }
        return r;
    }

    private Parsed parse(Unit u, Map<String, String> files) throws Exception {
        String primary = files.get(u.primary());
        if (primary == null) return null;
        String base = u.primary().substring(u.primary().lastIndexOf('/') + 1);
        String sibling = u.files().size() > 1 ? files.get(u.files().get(1)) : null;
        Parsed p = switch (base) {
            case "package-lock.json", "npm-shrinkwrap.json" -> Parsers.npmLock(u.primary(), primary, sibling, om);
            case "yarn.lock" -> Parsers.yarnLock(u.primary(), primary, sibling, om);
            case "package.json" -> Parsers.packageJson(u.primary(), primary, om);
            case "poetry.lock" -> Parsers.poetryLock(u.primary(), primary, sibling);
            case "Pipfile.lock" -> Parsers.pipfileLock(u.primary(), primary, om);
            case "pyproject.toml" -> Parsers.pyproject(u.primary(), primary);
            case "go.mod" -> Parsers.goMod(u.primary(), primary);
            case "Cargo.lock" -> Parsers.cargoLock(u.primary(), primary);
            case "Cargo.toml" -> Parsers.cargoToml(u.primary(), primary);
            case "Gemfile.lock" -> Parsers.gemfileLock(u.primary(), primary);
            case "composer.lock" -> Parsers.composerLock(u.primary(), primary, sibling, om);
            case "pom.xml" -> Parsers.pomXml(u.primary(), primary);
            case "build.gradle", "build.gradle.kts" -> Parsers.gradle(u.primary(), primary);
            default -> {
                if (base.endsWith(".txt")) {
                    Parsed merged = Parsers.requirementsTxt(u.primary(), primary);
                    for (int i = 1; i < u.files().size(); i++) {
                        String more = files.get(u.files().get(i));
                        if (more == null) continue;
                        Parsed extra = Parsers.requirementsTxt(u.files().get(i), more);
                        extra.nodes.forEach(merged.nodes::putIfAbsent);
                        merged.direct.addAll(extra.direct);
                        merged.notes.addAll(extra.notes);
                    }
                    if (u.files().size() > 1) merged.path = String.join(" + ", u.files());
                    yield merged;
                }
                yield null;
            }
        };
        if (p != null && base.equals("package.json") && u.files().stream().anyMatch(f -> f.endsWith("pnpm-lock.yaml"))) {
            p.notes.add("pnpm-lock.yaml is not parsed yet; versions were resolved from package.json ranges instead");
        }
        return p;
    }

    static String ddName(String system, String name) {
        return "PYPI".equals(system) ? Parsers.normPy(name) : name;
    }

    private void resolveRange(Parsed.Dep d, String ecosystem, SourceLog sl) {
        String system = DepsDevClient.systemFor(ecosystem);
        JsonNode pkg = depsDev.getPackage(system, ddName(system, d.name), sl);
        if (pkg == null) return;
        List<String> versions = new ArrayList<>();
        String def = null;
        for (JsonNode v : pkg.path("versions")) {
            String ver = v.path("versionKey").path("version").asText();
            versions.add(ver);
            if (v.path("isDefault").asBoolean(false)) def = ver;
        }
        String range = d.range == null ? "" : d.range.trim();
        String chosen;
        if (range.isEmpty() || range.equals("*") || range.equals("latest") || range.equals("managed")) {
            chosen = range.equals("managed") ? null : def;
        } else if (ecosystem.equals("npm")) {
            chosen = Versions.maxSatisfyingSemver(versions, range, false);
        } else if (ecosystem.equals("crates.io")) {
            chosen = Versions.maxSatisfyingSemver(versions, range, true);
        } else if (ecosystem.equals("PyPI")) {
            chosen = Versions.maxSatisfyingPep440(versions, range);
        } else {
            chosen = versions.contains(range) ? range : null;
        }
        d.version = chosen;
    }

    private void mergeExpansion(Graph g, JsonNode exp, String selfId, Parsed p, boolean dev) {
        JsonNode nodes = exp.path("nodes");
        String[] ids = new String[nodes.size()];
        for (int i = 0; i < nodes.size(); i++) {
            JsonNode vk = nodes.get(i).path("versionKey");
            if ("SELF".equals(nodes.get(i).path("relation").asText())) {
                ids[i] = selfId;
                continue;
            }
            String system = vk.path("system").asText();
            String eco = switch (system) {
                case "NPM" -> "npm";
                case "PYPI" -> "PyPI";
                case "CARGO" -> "crates.io";
                case "MAVEN" -> "Maven";
                case "GO" -> "Go";
                default -> p.ecosystem;
            };
            PackageNode n = g.node(eco, system, vk.path("name").asText(), vk.path("version").asText(), "deps.dev-resolved", null, p.path, dev);
            ids[i] = n.id;
        }
        for (JsonNode e : exp.path("edges")) {
            int a = e.path("fromNode").asInt(-1), b = e.path("toNode").asInt(-1);
            if (a >= 0 && b >= 0 && a < ids.length && b < ids.length && ids[a] != null && ids[b] != null && !ids[a].equals(ids[b])) g.edge(ids[a], ids[b]);
        }
    }

    private static void computeDepth(Graph g) {
        Map<String, List<String>> out = g.adjacency(false);
        Deque<String> q = new ArrayDeque<>();
        Map<String, Integer> depth = new HashMap<>();
        depth.put(ROOT, 0);
        q.add(ROOT);
        while (!q.isEmpty()) {
            String cur = q.poll();
            for (String nxt : out.getOrDefault(cur, List.of())) {
                if (!depth.containsKey(nxt)) {
                    depth.put(nxt, depth.get(cur) + 1);
                    q.add(nxt);
                }
            }
        }
        for (PackageNode n : g.nodes.values()) n.depth = depth.getOrDefault(n.id, -1);
    }

    private static void computeCounts(Graph g) {
        Map<String, List<String>> out = g.adjacency(false), in = g.adjacency(true);
        for (PackageNode n : g.nodes.values()) {
            n.dependencies = out.getOrDefault(n.id, List.of()).size();
            n.dependents = (int) in.getOrDefault(n.id, List.of()).stream().filter(x -> !x.equals(ROOT)).count();
            Set<String> seen = new HashSet<>();
            Deque<String> q = new ArrayDeque<>(List.of(n.id));
            while (!q.isEmpty()) {
                for (String p : in.getOrDefault(q.poll(), List.of())) {
                    if (!p.equals(ROOT) && seen.add(p)) q.add(p);
                }
            }
            n.transitiveDependents = seen.size();
        }
    }

    static <T> void parallel(Collection<T> items, Consumer<T> fn) {
        try (ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor()) {
            for (T t : items) {
                ex.submit(() -> {
                    try {
                        fn.accept(t);
                    } catch (Exception e) {
                        log.debug("parallel task failed", e);
                    }
                });
            }
        }
    }

    static <T> void parallel(Collection<T> items, Consumer<T> fn, Progress progress, String stage, String label, int fromPct, int toPct) {
        AtomicInteger done = new AtomicInteger();
        int total = items.size();
        int step = Math.max(1, total / 12);
        parallel(items, t -> {
            fn.accept(t);
            int d = done.incrementAndGet();
            if (d % step == 0 || d == total) {
                progress.emit(stage, label + " (" + d + "/" + total + ")", fromPct + (toPct - fromPct) * d / Math.max(1, total));
            }
        });
    }

    // ===================================================================== graph

    static class Graph {
        final Map<String, PackageNode> nodes = new LinkedHashMap<>();
        final List<Edge> edges = new ArrayList<>();
        private final Set<String> edgeKeys = new HashSet<>();

        PackageNode node(String eco, String system, String name, String version, String source, String range, String manifest, boolean dev) {
            String idName = "PyPI".equals(eco) ? Parsers.normPy(name) : name;
            String id = eco + ":" + idName + "@" + (version == null ? "unresolved" : version);
            PackageNode n = nodes.get(id);
            if (n == null) {
                n = new PackageNode();
                n.id = id;
                n.name = name;
                n.version = version;
                n.ecosystem = eco;
                n.system = system;
                n.versionSource = source;
                n.declaredRange = range;
                n.manifest = manifest;
                n.dev = dev;
                nodes.put(id, n);
            } else {
                n.dev = n.dev && dev;
                if (n.declaredRange == null) n.declaredRange = range;
                if (rank(source) > rank(n.versionSource)) n.versionSource = source;
            }
            return n;
        }

        private static int rank(String s) {
            return switch (s) {
                case "lockfile" -> 4;
                case "pinned" -> 3;
                case "resolved-range" -> 2;
                case "deps.dev-resolved" -> 1;
                default -> 0;
            };
        }

        void edge(String from, String to) {
            if (edgeKeys.add(from + "\u0000" + to)) edges.add(new Edge(from, to));
        }

        Map<String, List<String>> adjacency(boolean reverse) {
            Map<String, List<String>> m = new HashMap<>();
            for (Edge e : edges) {
                if (reverse) m.computeIfAbsent(e.to, k -> new ArrayList<>()).add(e.from);
                else m.computeIfAbsent(e.from, k -> new ArrayList<>()).add(e.to);
            }
            return m;
        }
    }
}
