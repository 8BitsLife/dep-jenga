package dev.depjenga.sources;

import com.fasterxml.jackson.databind.JsonNode;
import dev.depjenga.analysis.SourceLog;
import dev.depjenga.http.Http;
import dev.depjenga.http.TtlCache;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/** OSV.dev vulnerability database (https://google.github.io/osv.dev/api/). */
@Component
public class OsvClient {
    public static final String NAME = "OSV.dev";
    private static final String BASE = "https://api.osv.dev/v1";

    public record Query(String ecosystem, String name, String version) {}

    private final Http http;
    private final TtlCache<JsonNode> vulnCache = new TtlCache<>(3600_000L, 20_000);

    public OsvClient(Http http) {
        this.http = http;
    }

    /** Returns, for each query in order, the advisory ids affecting that exact version. Null entry = query failed. */
    public List<Set<String>> queryBatch(List<Query> queries, SourceLog log) {
        List<Set<String>> out = new ArrayList<>();
        for (int start = 0; start < queries.size(); start += 400) {
            List<Query> chunk = queries.subList(start, Math.min(queries.size(), start + 400));
            List<Map<String, Object>> body = new ArrayList<>();
            for (Query q : chunk) {
                body.add(Map.of("package", Map.of("name", q.name(), "ecosystem", q.ecosystem()), "version", q.version()));
            }
            try {
                JsonNode res = http.postJson(BASE + "/querybatch", Map.of("queries", body));
                log.ok(NAME);
                JsonNode results = res.path("results");
                for (int i = 0; i < chunk.size(); i++) {
                    JsonNode r = results.path(i);
                    Set<String> ids = new LinkedHashSet<>();
                    r.path("vulns").forEach(v -> ids.add(v.path("id").asText()));
                    String token = r.path("next_page_token").asText(null);
                    if (token != null && !token.isEmpty()) ids.addAll(paginate(chunk.get(i), token, log));
                    out.add(ids);
                }
            } catch (IOException e) {
                log.fail(NAME, e.getMessage());
                for (int i = 0; i < chunk.size(); i++) out.add(null);
            }
        }
        return out;
    }

    private Set<String> paginate(Query q, String token, SourceLog log) {
        Set<String> ids = new LinkedHashSet<>();
        for (int page = 0; page < 10 && token != null && !token.isEmpty(); page++) {
            try {
                JsonNode r = http.postJson(BASE + "/query", Map.of(
                        "package", Map.of("name", q.name(), "ecosystem", q.ecosystem()),
                        "version", q.version(),
                        "page_token", token));
                log.ok(NAME);
                r.path("vulns").forEach(v -> ids.add(v.path("id").asText()));
                token = r.path("next_page_token").asText(null);
            } catch (IOException e) {
                log.fail(NAME, e.getMessage());
                break;
            }
        }
        return ids;
    }

    public JsonNode vuln(String id, SourceLog log) {
        Optional<JsonNode> hit = vulnCache.get(id);
        if (hit != null) return hit.orElse(null);
        try {
            JsonNode n = http.getJson(BASE + "/vulns/" + Http.enc(id));
            log.ok(NAME);
            vulnCache.put(id, n);
            return n;
        } catch (IOException e) {
            log.fail(NAME, e.getMessage());
            return null;
        }
    }
}
