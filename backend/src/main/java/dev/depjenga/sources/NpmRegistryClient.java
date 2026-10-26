package dev.depjenga.sources;

import com.fasterxml.jackson.databind.JsonNode;
import dev.depjenga.analysis.SourceLog;
import dev.depjenga.http.Http;
import dev.depjenga.http.TtlCache;
import java.io.IOException;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** npm registry — used only for the maintainer count of npm packages (a direct bus-factor signal). */
@Component
public class NpmRegistryClient {
    public static final String NAME = "npm registry";

    private final Http http;
    private final TtlCache<JsonNode> cache = new TtlCache<>(6 * 3600_000L, 20_000);

    public NpmRegistryClient(Http http) {
        this.http = http;
    }

    /** The manifest of the version tagged `latest` (small document; includes `maintainers`). */
    public JsonNode latest(String name, SourceLog log) {
        String url = "https://registry.npmjs.org/" + name.replace("/", "%2F") + "/latest";
        Optional<JsonNode> hit = cache.get(url);
        if (hit != null) return hit.orElse(null);
        try {
            JsonNode n = http.getJson(url);
            log.ok(NAME);
            cache.put(url, n);
            return n;
        } catch (IOException e) {
            log.fail(NAME, e.getMessage());
            return null;
        }
    }
}
