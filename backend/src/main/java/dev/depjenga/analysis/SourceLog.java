package dev.depjenga.analysis;

import dev.depjenga.model.Model.SourceStatus;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Per-analysis record of which data sources were called and how they fared — surfaced in the UI. */
public class SourceLog {
    private final Map<String, SourceStatus> sources = new LinkedHashMap<>();

    public synchronized void register(String name, String url) {
        sources.computeIfAbsent(name, n -> {
            SourceStatus s = new SourceStatus();
            s.name = n;
            s.url = url;
            return s;
        });
    }

    public synchronized void ok(String name) {
        sources.get(name).calls++;
    }

    public synchronized void fail(String name, String message) {
        SourceStatus s = sources.get(name);
        s.calls++;
        s.failures++;
        if (s.message == null) s.message = message;
    }

    public synchronized void note(String name, String message) {
        sources.get(name).message = message;
    }

    public synchronized List<SourceStatus> snapshot() {
        for (SourceStatus s : sources.values()) {
            s.ok = s.calls == 0 ? s.message == null : s.failures < s.calls;
        }
        return new ArrayList<>(sources.values());
    }
}
