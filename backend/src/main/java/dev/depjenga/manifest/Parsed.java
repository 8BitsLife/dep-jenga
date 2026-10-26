package dev.depjenga.manifest;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Output of one manifest/lockfile parser: nodes keyed by a parser-local key, edges between keys, and the direct set. */
public class Parsed {
    public static class Dep {
        public String name, version, range;
        public boolean dev;
        /** lockfile | pinned | range */
        public String source;

        public Dep(String name, String version, String range, boolean dev, String source) {
            this.name = name;
            this.version = version;
            this.range = range;
            this.dev = dev;
            this.source = source;
        }
    }

    public String path, ecosystem, kind, parser;
    /** true when the file encodes the full resolved transitive graph (a lockfile). */
    public boolean complete;
    public final Map<String, Dep> nodes = new LinkedHashMap<>();
    public final List<String[]> edges = new ArrayList<>();
    public final Set<String> direct = new LinkedHashSet<>();
    public final List<String> notes = new ArrayList<>();

    public Parsed(String path, String ecosystem, String kind, String parser) {
        this.path = path;
        this.ecosystem = ecosystem;
        this.kind = kind;
        this.parser = parser;
    }

    public void edge(String from, String to) {
        edges.add(new String[] {from, to});
    }
}
