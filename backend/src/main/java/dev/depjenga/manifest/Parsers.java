package dev.depjenga.manifest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.depjenga.manifest.Parsed.Dep;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** Parsers for every supported manifest / lockfile format. Pure functions: text in, {@link Parsed} out. */
public final class Parsers {
    private Parsers() {}

    // =================================================================== npm

    private static boolean nonRegistrySpec(String range) {
        String r = range.trim();
        return r.startsWith("workspace:") || r.startsWith("file:") || r.startsWith("link:") || r.startsWith("git")
                || r.startsWith("http:") || r.startsWith("https:") || r.startsWith("portal:") || r.contains("/") && !r.startsWith("npm:");
    }

    /** package.json alone: direct deps with ranges (resolved later via deps.dev). */
    public static Parsed packageJson(String path, String text, ObjectMapper om) throws Exception {
        Parsed p = new Parsed(path, "npm", "manifest", "package.json");
        JsonNode root = om.readTree(text);
        String[][] sections = {{"dependencies", "false"}, {"optionalDependencies", "false"}, {"devDependencies", "true"}};
        for (String[] sec : sections) {
            Iterator<Map.Entry<String, JsonNode>> it = root.path(sec[0]).fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                String name = e.getKey(), range = e.getValue().asText();
                if (range.startsWith("npm:")) {
                    String spec = range.substring(4);
                    int at = spec.lastIndexOf('@');
                    if (at > 0) {
                        name = spec.substring(0, at);
                        range = spec.substring(at + 1);
                    } else {
                        name = spec;
                        range = "*";
                    }
                }
                if (nonRegistrySpec(range)) {
                    p.notes.add(e.getKey() + " uses a non-registry source (" + range + ") and was skipped");
                    continue;
                }
                if (!p.nodes.containsKey(name)) {
                    p.nodes.put(name, new Dep(name, null, range, Boolean.parseBoolean(sec[1]), "range"));
                    p.direct.add(name);
                }
            }
        }
        return p;
    }

    private static String resolveNpm(Set<String> keys, String from, String dep) {
        String base = from;
        while (true) {
            String cand = base.isEmpty() ? "node_modules/" + dep : base + "/node_modules/" + dep;
            if (keys.contains(cand)) return cand;
            if (base.isEmpty()) return null;
            int idx = base.lastIndexOf("/node_modules/");
            base = idx >= 0 ? base.substring(0, idx) : "";
        }
    }

    private static List<String> depNames(JsonNode n, String... fields) {
        List<String> out = new ArrayList<>();
        for (String f : fields) n.path(f).fieldNames().forEachRemaining(out::add);
        return out;
    }

    /** package-lock.json / npm-shrinkwrap.json, lockfileVersion 1, 2 and 3. */
    public static Parsed npmLock(String path, String text, String packageJsonText, ObjectMapper om) throws Exception {
        Parsed p = new Parsed(path, "npm", "lockfile", "package-lock.json");
        p.complete = true;
        JsonNode root = om.readTree(text);
        Map<String, List<String>> requires = new HashMap<>();
        Map<String, List<String>> rootRequires = new LinkedHashMap<>();
        JsonNode pk = root.path("packages");
        if (pk.isObject() && pk.size() > 0) {
            Iterator<Map.Entry<String, JsonNode>> it = pk.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                String key = e.getKey();
                JsonNode v = e.getValue();
                if (!key.contains("node_modules/")) {
                    // "" is the project root; other non node_modules entries are workspace packages
                    rootRequires.put(key, depNames(v, "dependencies", "devDependencies", "optionalDependencies"));
                    continue;
                }
                if (v.path("link").asBoolean(false)) continue;
                String version = v.path("version").asText(null);
                if (version == null || version.isEmpty()) continue;
                String name = v.hasNonNull("name") ? v.get("name").asText() : key.substring(key.lastIndexOf("node_modules/") + 13);
                boolean dev = v.path("dev").asBoolean(false) || v.path("devOptional").asBoolean(false);
                p.nodes.put(key, new Dep(name, version, null, dev, "lockfile"));
                requires.put(key, depNames(v, "dependencies", "optionalDependencies", "peerDependencies"));
            }
        } else {
            p.parser = "package-lock.json (v1)";
            walkV1(root.path("dependencies"), "", p, requires);
            if (packageJsonText != null) {
                JsonNode pj = om.readTree(packageJsonText);
                rootRequires.put("", depNames(pj, "dependencies", "devDependencies", "optionalDependencies"));
            }
        }
        Set<String> keys = p.nodes.keySet();
        for (Map.Entry<String, List<String>> e : requires.entrySet()) {
            for (String dep : e.getValue()) {
                String target = resolveNpm(keys, e.getKey(), dep);
                if (target != null && !target.equals(e.getKey())) p.edge(e.getKey(), target);
            }
        }
        for (Map.Entry<String, List<String>> e : rootRequires.entrySet()) {
            for (String dep : e.getValue()) {
                String target = resolveNpm(keys, e.getKey(), dep);
                if (target != null) p.direct.add(target);
            }
        }
        if (rootRequires.size() > 1) p.notes.add("npm workspaces detected: " + (rootRequires.size() - 1) + " workspace packages merged into one tree");
        return p;
    }

    private static void walkV1(JsonNode deps, String prefix, Parsed p, Map<String, List<String>> requires) {
        Iterator<Map.Entry<String, JsonNode>> it = deps.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            String key = (prefix.isEmpty() ? "" : prefix + "/") + "node_modules/" + e.getKey();
            JsonNode v = e.getValue();
            String version = v.path("version").asText("");
            if (!version.isEmpty() && !version.startsWith("file:") && !version.startsWith("git")) {
                p.nodes.put(key, new Dep(e.getKey(), version, null, v.path("dev").asBoolean(false), "lockfile"));
                requires.put(key, depNames(v, "requires"));
            }
            if (v.has("dependencies")) walkV1(v.get("dependencies"), key, p, requires);
        }
    }

    private static final Pattern YARN_DEP = Pattern.compile("^\"?((?:@[^/\"\\s]+/)?[^\"\\s:]+)\"?:?\\s+\"?([^\"]+)\"?$");

    /** yarn.lock, classic (v1) and berry (v2+) formats. */
    public static Parsed yarnLock(String path, String text, String packageJsonText, ObjectMapper om) throws Exception {
        Parsed p = new Parsed(path, "npm", "lockfile", "yarn.lock");
        p.complete = true;
        Map<String, String> specToKey = new HashMap<>();
        Map<String, Map<String, String>> depsOf = new LinkedHashMap<>();
        List<String> specs = null;
        String version = null;
        Map<String, String> deps = new LinkedHashMap<>();
        boolean inDeps = false;
        String[] lines = text.split("\r?\n");
        for (int i = 0; i <= lines.length; i++) {
            String line = i < lines.length ? lines[i] : "";
            boolean header = i == lines.length || (!line.isEmpty() && !line.startsWith(" ") && !line.startsWith("#"));
            if (header) {
                if (specs != null && version != null && !version.contains("use.local")) {
                    String first = specs.get(0);
                    int at = first.lastIndexOf('@');
                    String name = at > 0 ? first.substring(0, at) : first;
                    boolean workspace = first.contains("@workspace:");
                    if (!workspace && !name.equals("__metadata")) {
                        String key = name + "@" + version;
                        p.nodes.putIfAbsent(key, new Dep(name, version, null, false, "lockfile"));
                        for (String s : specs) specToKey.put(s, key);
                        depsOf.computeIfAbsent(key, k -> new LinkedHashMap<>()).putAll(deps);
                    }
                }
                if (i == lines.length) break;
                String h = line.trim();
                if (h.endsWith(":")) h = h.substring(0, h.length() - 1);
                specs = new ArrayList<>();
                for (String s : h.split(",\\s*")) specs.add(s.replace("\"", "").trim());
                version = null;
                deps = new LinkedHashMap<>();
                inDeps = false;
                continue;
            }
            if (line.isBlank() || line.trim().startsWith("#")) continue;
            int indent = line.length() - line.stripLeading().length();
            String t = line.trim();
            if (indent == 2) {
                inDeps = t.startsWith("dependencies") || t.startsWith("optionalDependencies");
                if (t.startsWith("version")) version = t.replaceFirst("^version:?\\s+", "").replace("\"", "").trim();
            } else if (indent >= 4 && inDeps) {
                Matcher m = YARN_DEP.matcher(t);
                if (m.matches()) deps.put(m.group(1), m.group(2));
            }
        }
        for (Map.Entry<String, Map<String, String>> e : depsOf.entrySet()) {
            for (Map.Entry<String, String> d : e.getValue().entrySet()) {
                String target = yarnLookup(specToKey, d.getKey(), d.getValue());
                if (target != null && !target.equals(e.getKey())) p.edge(e.getKey(), target);
            }
        }
        if (packageJsonText != null) {
            JsonNode pj = om.readTree(packageJsonText);
            for (String sec : new String[] {"dependencies", "devDependencies", "optionalDependencies"}) {
                Iterator<Map.Entry<String, JsonNode>> it = pj.path(sec).fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    String target = yarnLookup(specToKey, e.getKey(), e.getValue().asText());
                    if (target != null) {
                        p.direct.add(target);
                        if (sec.equals("devDependencies")) p.nodes.get(target).dev = true;
                    }
                }
            }
        }
        return p;
    }

    private static String yarnLookup(Map<String, String> specToKey, String name, String range) {
        String k = specToKey.get(name + "@" + range);
        if (k == null) k = specToKey.get(name + "@npm:" + range);
        if (k == null && range.startsWith("npm:")) k = specToKey.get(name + "@" + range);
        return k;
    }

    // =================================================================== Python

    private static final Pattern PEP508 = Pattern.compile("^([A-Za-z0-9][A-Za-z0-9._\\-]*)\\s*(\\[[^\\]]*\\])?\\s*(.*)$");
    private static final Pattern PINNED = Pattern.compile("^===?\\s*([^,*\\s]+)$");

    public static String normPy(String name) {
        return name.toLowerCase().replaceAll("[-_.]+", "-");
    }

    /** Parses one PEP 508 requirement string into a Dep, or null if it is not a registry requirement. */
    static Dep pep508(String raw, boolean dev, List<String> notes) {
        String line = raw.split(";")[0].trim();
        if (line.isEmpty()) return null;
        if (line.contains("://") || line.contains(" @ ")) {
            notes.add(line + " points at a URL/VCS source and was skipped");
            return null;
        }
        Matcher m = PEP508.matcher(line);
        if (!m.matches()) return null;
        String name = m.group(1);
        String spec = m.group(3).trim().replaceAll("^\\(|\\)$", "").trim();
        Matcher pin = PINNED.matcher(spec);
        if (pin.matches()) return new Dep(name, pin.group(1), spec, dev, "pinned");
        return new Dep(name, null, spec, dev, "range");
    }

    public static Parsed requirementsTxt(String path, String text) {
        Parsed p = new Parsed(path, "PyPI", "manifest", "requirements.txt");
        boolean dev = path.toLowerCase().matches(".*(dev|test|lint|doc).*");
        String joined = text.replaceAll("\\\\\\r?\\n", " ");
        for (String raw : joined.split("\r?\n")) {
            String line = raw.replaceAll("\\s+#.*$", "").replaceAll("--hash=\\S+", "").trim();
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("-")) continue;
            Dep d = pep508(line, dev, p.notes);
            if (d == null) continue;
            String key = normPy(d.name);
            p.nodes.putIfAbsent(key, d);
            p.direct.add(key);
        }
        return p;
    }

    private static final Pattern TOML_SECTION = Pattern.compile("^\\s*\\[\\[?([^\\]]+)\\]\\]?\\s*$");
    private static final Pattern TOML_KV = Pattern.compile("^\\s*\"?([A-Za-z0-9_.\\-]+)\"?\\s*=\\s*(.+)$");
    private static final Pattern TOML_VERSION = Pattern.compile("version\\s*=\\s*\"([^\"]*)\"");
    private static final Pattern QUOTED = Pattern.compile("\"([^\"]*)\"|'([^']*)'");

    /** pyproject.toml: PEP 621 [project] dependencies and Poetry dependency tables. */
    public static Parsed pyproject(String path, String text) {
        Parsed p = new Parsed(path, "PyPI", "manifest", "pyproject.toml");
        String section = "";
        boolean inArray = false;
        StringBuilder array = new StringBuilder();
        for (String line : text.split("\r?\n")) {
            Matcher sec = TOML_SECTION.matcher(line);
            if (!inArray && sec.matches()) {
                section = sec.group(1).trim();
                continue;
            }
            if (section.equals("project")) {
                if (!inArray && line.trim().startsWith("dependencies")) {
                    inArray = true;
                    array.setLength(0);
                }
                if (inArray) {
                    array.append(line.replaceAll("#.*$", "")).append('\n');
                    if (line.contains("]")) {
                        inArray = false;
                        Matcher q = QUOTED.matcher(array.toString());
                        while (q.find()) addPy(p, pep508(q.group(1) != null ? q.group(1) : q.group(2), false, p.notes));
                    }
                }
            } else if (section.startsWith("tool.poetry") && section.endsWith("dependencies")) {
                boolean dev = section.contains("dev") || section.contains("test");
                Matcher kv = TOML_KV.matcher(line);
                if (!kv.matches()) continue;
                String name = kv.group(1), value = kv.group(2).trim();
                if (name.equalsIgnoreCase("python")) continue;
                String range;
                if (value.startsWith("{")) {
                    Matcher v = TOML_VERSION.matcher(value);
                    if (!v.find()) {
                        p.notes.add(name + " uses a path/git source and was skipped");
                        continue;
                    }
                    range = v.group(1);
                } else {
                    range = value.replace("\"", "").replace("'", "").trim();
                }
                Matcher pin = Pattern.compile("^(?:==)?\\s*(\\d[\\w.]*)$").matcher(range);
                Dep d = pin.matches() ? new Dep(name, pin.group(1), range, dev, "pinned") : new Dep(name, null, range, dev, "range");
                addPy(p, d);
            }
        }
        return p;
    }

    private static void addPy(Parsed p, Dep d) {
        if (d == null) return;
        String key = normPy(d.name);
        p.nodes.putIfAbsent(key, d);
        p.direct.add(key);
    }

    /** poetry.lock: full resolved set plus per-package dependency tables. */
    public static Parsed poetryLock(String path, String text, String pyprojectText) {
        Parsed p = new Parsed(path, "PyPI", "lockfile", "poetry.lock");
        p.complete = true;
        Map<String, Set<String>> deps = new LinkedHashMap<>();
        String name = null, version = null, category = null, section = "";
        Set<String> cur = new HashSet<>();
        String[] lines = (text + "\n[[package]]").split("\r?\n");
        for (String line : lines) {
            Matcher sec = TOML_SECTION.matcher(line);
            if (sec.matches()) {
                String s = sec.group(1).trim();
                if (line.trim().startsWith("[[package]]") || s.equals("metadata")) {
                    if (name != null && version != null) {
                        String key = normPy(name);
                        p.nodes.put(key, new Dep(name, version, null, "dev".equals(category), "lockfile"));
                        deps.put(key, cur);
                    }
                    name = version = category = null;
                    cur = new HashSet<>();
                }
                section = s;
                continue;
            }
            Matcher kv = TOML_KV.matcher(line);
            if (!kv.matches()) continue;
            if (section.equals("package")) {
                String v = kv.group(2).replace("\"", "").trim();
                switch (kv.group(1)) {
                    case "name" -> name = v;
                    case "version" -> version = v;
                    case "category" -> category = v;
                    default -> {}
                }
            } else if (section.equals("package.dependencies")) {
                cur.add(normPy(kv.group(1)));
            }
        }
        for (Map.Entry<String, Set<String>> e : deps.entrySet()) {
            for (String d : e.getValue()) if (p.nodes.containsKey(d)) p.edge(e.getKey(), d);
        }
        if (pyprojectText != null) {
            Parsed pp = pyproject(path, pyprojectText);
            for (Map.Entry<String, Dep> e : pp.nodes.entrySet()) {
                if (p.nodes.containsKey(e.getKey())) {
                    p.direct.add(e.getKey());
                    if (e.getValue().dev) p.nodes.get(e.getKey()).dev = true;
                }
            }
        }
        return p;
    }

    /** Pipfile.lock: pinned set, but it records neither edges nor which packages are direct. */
    public static Parsed pipfileLock(String path, String text, ObjectMapper om) throws Exception {
        Parsed p = new Parsed(path, "PyPI", "lockfile", "Pipfile.lock");
        JsonNode root = om.readTree(text);
        for (String sec : new String[] {"default", "develop"}) {
            Iterator<Map.Entry<String, JsonNode>> it = root.path(sec).fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                String v = e.getValue().path("version").asText("").replace("==", "");
                if (v.isEmpty()) continue;
                String key = normPy(e.getKey());
                p.nodes.putIfAbsent(key, new Dep(e.getKey(), v, null, sec.equals("develop"), "lockfile"));
                p.direct.add(key);
            }
        }
        p.notes.add("Pipfile.lock does not record dependency edges; every package is shown as a direct dependency");
        return p;
    }

    // =================================================================== Go

    public static Parsed goMod(String path, String text) {
        Parsed p = new Parsed(path, "Go", "lockfile", "go.mod");
        boolean inBlock = false;
        int indirect = 0;
        for (String raw : text.split("\r?\n")) {
            String line = raw.trim();
            if (line.startsWith("require (")) { inBlock = true; continue; }
            if (inBlock && line.startsWith(")")) { inBlock = false; continue; }
            String spec = null;
            if (inBlock) spec = line;
            else if (line.startsWith("require ")) spec = line.substring(8).trim();
            if (spec == null || spec.isEmpty() || spec.startsWith("//")) continue;
            boolean isIndirect = spec.contains("// indirect");
            String[] parts = spec.replaceAll("//.*$", "").trim().split("\\s+");
            if (parts.length < 2) continue;
            p.nodes.putIfAbsent(parts[0], new Dep(parts[0], parts[1], null, false, "lockfile"));
            if (!isIndirect) p.direct.add(parts[0]);
            else indirect++;
        }
        if (indirect > 0) {
            p.notes.add(indirect + " indirect Go modules are listed in go.mod without their parent module; they are attached to the project root");
        }
        return p;
    }

    // =================================================================== Rust

    public static Parsed cargoLock(String path, String text) {
        Parsed p = new Parsed(path, "crates.io", "lockfile", "Cargo.lock");
        p.complete = true;
        record Pkg(String name, String version, String source, List<String> deps) {}
        List<Pkg> pkgs = new ArrayList<>();
        String name = null, version = null, source = null;
        List<String> deps = new ArrayList<>();
        boolean inDeps = false;
        for (String line : (text + "\n[[package]]").split("\r?\n")) {
            String t = line.trim();
            if (t.equals("[[package]]") || t.startsWith("[metadata")) {
                if (name != null) pkgs.add(new Pkg(name, version, source, deps));
                name = version = source = null;
                deps = new ArrayList<>();
                inDeps = false;
                continue;
            }
            if (inDeps) {
                if (t.startsWith("]")) { inDeps = false; continue; }
                Matcher q = QUOTED.matcher(t);
                if (q.find()) deps.add(q.group(1));
                continue;
            }
            Matcher kv = TOML_KV.matcher(line);
            if (!kv.matches()) continue;
            String v = kv.group(2).trim();
            switch (kv.group(1)) {
                case "name" -> name = v.replace("\"", "");
                case "version" -> version = v.replace("\"", "");
                case "source" -> source = v.replace("\"", "");
                case "dependencies" -> {
                    if (v.startsWith("[") && v.endsWith("]")) {
                        Matcher q = QUOTED.matcher(v);
                        while (q.find()) deps.add(q.group(1));
                    } else inDeps = true;
                }
                default -> {}
            }
        }
        Map<String, List<String>> versionsByName = new HashMap<>();
        Set<String> local = new HashSet<>();
        int git = 0;
        for (Pkg k : pkgs) {
            if (k.source() == null) { local.add(k.name()); continue; }
            if (!k.source().startsWith("registry+")) { git++; continue; }
            p.nodes.put(k.name() + "@" + k.version(), new Dep(k.name(), k.version(), null, false, "lockfile"));
            versionsByName.computeIfAbsent(k.name(), x -> new ArrayList<>()).add(k.version());
        }
        for (Pkg k : pkgs) {
            String from = k.source() == null ? null : k.name() + "@" + k.version();
            if (from != null && !p.nodes.containsKey(from)) continue;
            for (String d : k.deps()) {
                String[] parts = d.split(" ");
                List<String> vs = versionsByName.get(parts[0]);
                if (vs == null) continue;
                String target = parts[0] + "@" + (parts.length > 1 ? parts[1] : vs.get(0));
                if (!p.nodes.containsKey(target)) continue;
                if (from == null) p.direct.add(target);
                else p.edge(from, target);
            }
        }
        if (git > 0) p.notes.add(git + " crates come from git sources and were skipped (not checkable against crates.io advisories)");
        if (!local.isEmpty()) p.notes.add("Workspace crates: " + String.join(", ", local.stream().limit(8).toList()) + (local.size() > 8 ? "…" : ""));
        return p;
    }

    public static Parsed cargoToml(String path, String text) {
        Parsed p = new Parsed(path, "crates.io", "manifest", "Cargo.toml");
        String section = "";
        for (String line : text.split("\r?\n")) {
            Matcher sec = TOML_SECTION.matcher(line);
            if (sec.matches()) { section = sec.group(1).trim(); continue; }
            if (!(section.endsWith("dependencies"))) continue;
            boolean dev = section.contains("dev-");
            Matcher kv = TOML_KV.matcher(line);
            if (!kv.matches()) continue;
            String name = kv.group(1), value = kv.group(2).trim(), range;
            if (value.startsWith("{")) {
                Matcher v = TOML_VERSION.matcher(value);
                if (!v.find()) continue;
                range = v.group(1);
            } else range = value.replace("\"", "");
            p.nodes.putIfAbsent(name, new Dep(name, null, range, dev, "range"));
            p.direct.add(name);
        }
        return p;
    }

    // =================================================================== Ruby

    private static String stripRubyPlatform(String v) {
        Matcher m = Pattern.compile("^(\\d[\\w.]*?)-(.*)$").matcher(v);
        if (m.matches() && m.group(2).matches(".*(linux|darwin|mingw|mswin|java|x86|x64|arm|aarch|universal).*")) return m.group(1);
        return v;
    }

    public static Parsed gemfileLock(String path, String text) {
        Parsed p = new Parsed(path, "RubyGems", "lockfile", "Gemfile.lock");
        p.complete = true;
        String section = "";
        String current = null;
        Map<String, List<String>> deps = new LinkedHashMap<>();
        List<String> direct = new ArrayList<>();
        for (String line : text.split("\r?\n")) {
            if (line.isBlank()) continue;
            if (!line.startsWith(" ")) { section = line.trim(); current = null; continue; }
            int indent = line.length() - line.stripLeading().length();
            String t = line.trim();
            if (section.equals("GEM")) {
                Matcher m = Pattern.compile("^([^\\s(]+)(?: \\(([^)]+)\\))?$").matcher(t);
                if (!m.matches()) continue;
                if (indent == 4 && m.group(2) != null) {
                    current = m.group(1);
                    p.nodes.putIfAbsent(current, new Dep(current, stripRubyPlatform(m.group(2)), null, false, "lockfile"));
                    deps.putIfAbsent(current, new ArrayList<>());
                } else if (indent == 6 && current != null) {
                    deps.get(current).add(m.group(1));
                }
            } else if (section.equals("DEPENDENCIES") && indent == 2) {
                direct.add(t.split("[\\s(!]")[0]);
            }
        }
        deps.forEach((from, tos) -> tos.forEach(to -> { if (p.nodes.containsKey(to)) p.edge(from, to); }));
        for (String d : direct) if (p.nodes.containsKey(d)) p.direct.add(d);
        return p;
    }

    // =================================================================== PHP

    private static boolean phpPlatform(String n) {
        return n.equals("php") || n.startsWith("ext-") || n.startsWith("lib-") || n.startsWith("composer-") || !n.contains("/");
    }

    public static Parsed composerLock(String path, String text, String composerJson, ObjectMapper om) throws Exception {
        Parsed p = new Parsed(path, "Packagist", "lockfile", "composer.lock");
        p.complete = true;
        JsonNode root = om.readTree(text);
        Map<String, List<String>> deps = new HashMap<>();
        for (String sec : new String[] {"packages", "packages-dev"}) {
            for (JsonNode pkg : root.path(sec)) {
                String name = pkg.path("name").asText();
                String v = pkg.path("version").asText().replaceFirst("^v", "");
                if (v.startsWith("dev-")) continue;
                p.nodes.put(name.toLowerCase(), new Dep(name, v, null, sec.equals("packages-dev"), "lockfile"));
                deps.put(name.toLowerCase(), depNames(pkg, "require"));
            }
        }
        deps.forEach((from, tos) -> tos.forEach(to -> {
            if (!phpPlatform(to) && p.nodes.containsKey(to.toLowerCase())) p.edge(from, to.toLowerCase());
        }));
        if (composerJson != null) {
            JsonNode cj = om.readTree(composerJson);
            for (String n : depNames(cj, "require", "require-dev")) if (p.nodes.containsKey(n.toLowerCase())) p.direct.add(n.toLowerCase());
        }
        return p;
    }

    // =================================================================== JVM

    private static String text(Element parent, String tag) {
        NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            Node n = nl.item(i);
            if (n instanceof Element el && el.getTagName().equals(tag)) return el.getTextContent().trim();
        }
        return null;
    }

    private static Element child(Element parent, String tag) {
        NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) {
            Node n = nl.item(i);
            if (n instanceof Element el && el.getTagName().equals(tag)) return el;
        }
        return null;
    }

    private static String interpolate(String v, Map<String, String> props) {
        if (v == null) return null;
        Matcher m = Pattern.compile("\\$\\{([^}]+)}").matcher(v);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String r = props.get(m.group(1));
            if (r == null) return null;
            m.appendReplacement(sb, Matcher.quoteReplacement(r));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    public static Parsed pomXml(String path, String text) throws Exception {
        Parsed p = new Parsed(path, "Maven", "manifest", "pom.xml");
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        f.setExpandEntityReferences(false);
        DocumentBuilder b = f.newDocumentBuilder();
        Document doc = b.parse(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
        Element project = doc.getDocumentElement();
        Map<String, String> props = new HashMap<>();
        Element parent = child(project, "parent");
        String pv = text(project, "version");
        if (pv == null && parent != null) pv = text(parent, "version");
        if (pv != null) { props.put("project.version", pv); props.put("version", pv); }
        Element properties = child(project, "properties");
        if (properties != null) {
            NodeList nl = properties.getChildNodes();
            for (int i = 0; i < nl.getLength(); i++) if (nl.item(i) instanceof Element el) props.put(el.getTagName(), el.getTextContent().trim());
        }
        Map<String, String> managed = new HashMap<>();
        Element dm = child(project, "dependencyManagement");
        if (dm != null && child(dm, "dependencies") != null) {
            for (Element d : elements(child(dm, "dependencies"), "dependency")) {
                String v = interpolate(text(d, "version"), props);
                if (v != null) managed.put(text(d, "groupId") + ":" + text(d, "artifactId"), v);
            }
        }
        Element deps = child(project, "dependencies");
        int unresolved = 0;
        if (deps != null) {
            for (Element d : elements(deps, "dependency")) {
                String g = interpolate(text(d, "groupId"), props), a = interpolate(text(d, "artifactId"), props);
                if (g == null || a == null) continue;
                String name = g + ":" + a;
                String v = interpolate(text(d, "version"), props);
                if (v == null) v = managed.get(name);
                boolean dev = "test".equals(text(d, "scope"));
                if (v == null) unresolved++;
                else if (v.startsWith("[") || v.startsWith("(")) v = null;
                p.nodes.putIfAbsent(name, new Dep(name, v, v == null ? "managed" : v, dev, v == null ? "range" : "pinned"));
                p.direct.add(name);
            }
        }
        if (unresolved > 0) p.notes.add(unresolved + " dependencies inherit their version from a parent POM or BOM that was not fetched; their versions are unresolved");
        return p;
    }

    private static List<Element> elements(Element parent, String tag) {
        List<Element> out = new ArrayList<>();
        NodeList nl = parent.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) if (nl.item(i) instanceof Element el && el.getTagName().equals(tag)) out.add(el);
        return out;
    }

    private static final Pattern GRADLE = Pattern.compile(
            "\\b(implementation|api|compile|runtimeOnly|compileOnly|kapt|ksp|annotationProcessor|testImplementation|testRuntimeOnly|testCompileOnly|androidTestImplementation)\\s*\\(?\\s*[\"']([^:\"'\\s]+):([^:\"'\\s]+):([^\"'@\\s]+)[\"']");

    public static Parsed gradle(String path, String text) {
        Parsed p = new Parsed(path, "Maven", "manifest", path.endsWith(".kts") ? "build.gradle.kts" : "build.gradle");
        Matcher m = GRADLE.matcher(text);
        int vars = 0;
        while (m.find()) {
            String name = m.group(2) + ":" + m.group(3);
            String v = m.group(4);
            boolean dev = m.group(1).toLowerCase().contains("test");
            if (v.contains("$") || v.contains("+")) { vars++; continue; }
            p.nodes.putIfAbsent(name, new Dep(name, v, v, dev, "pinned"));
            p.direct.add(name);
        }
        if (vars > 0) p.notes.add(vars + " Gradle dependencies use variables or dynamic versions and were skipped");
        if (text.contains("libs.")) p.notes.add("Gradle version catalogs (libs.*) are not resolved");
        return p;
    }
}
