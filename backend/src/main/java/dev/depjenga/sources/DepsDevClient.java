package dev.depjenga.sources;

import com.fasterxml.jackson.databind.JsonNode;
import dev.depjenga.analysis.SourceLog;
import dev.depjenga.http.Http;
import dev.depjenga.http.TtlCache;
import java.io.IOException;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Google's Open Source Insights API (https://docs.deps.dev/api/v3/). No auth required. */
@Component
public class DepsDevClient {
    public static final String NAME = "deps.dev (Open Source Insights)";
    private static final String BASE = "https://api.deps.dev/v3";

    private final Http http;
    private final TtlCache<JsonNode> cache = new TtlCache<>(2 * 3600_000L, 50_000);

    public DepsDevClient(Http http) {
        this.http = http;
    }

    public static String systemFor(String osvEcosystem) {
        return switch (osvEcosystem) {
            case "npm" -> "NPM";
            case "PyPI" -> "PYPI";
            case "Go" -> "GO";
            case "crates.io" -> "CARGO";
            case "Maven" -> "MAVEN";
            case "NuGet" -> "NUGET";
            case "RubyGems" -> "RUBYGEMS";
            default -> null;
        };
    }

    public static boolean supportsResolution(String system) {
        return "NPM".equals(system) || "PYPI".equals(system) || "CARGO".equals(system) || "MAVEN".equals(system);
    }

    private JsonNode cached(String url, SourceLog log) {
        Optional<JsonNode> hit = cache.get(url);
        if (hit != null) return hit.orElse(null);
        try {
            JsonNode n = http.getJson(url);
            log.ok(NAME);
            cache.put(url, n);
            return n;
        } catch (Http.HttpStatusException e) {
            log.fail(NAME, "HTTP " + e.status);
            if (e.status == 400) cache.put(url, null);
            return null;
        } catch (IOException e) {
            log.fail(NAME, e.getMessage());
            return null;
        }
    }

    public JsonNode getPackage(String system, String name, SourceLog log) {
        return cached(BASE + "/systems/" + system + "/packages/" + Http.enc(name), log);
    }

    public JsonNode getVersion(String system, String name, String version, SourceLog log) {
        return cached(BASE + "/systems/" + system + "/packages/" + Http.enc(name) + "/versions/" + Http.enc(version), log);
    }

    public JsonNode getDependencies(String system, String name, String version, SourceLog log) {
        return cached(BASE + "/systems/" + system + "/packages/" + Http.enc(name) + "/versions/" + Http.enc(version) + ":dependencies", log);
    }

    public JsonNode getProject(String projectId, SourceLog log) {
        return cached(BASE + "/projects/" + Http.enc(projectId), log);
    }
}
