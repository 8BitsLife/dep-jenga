package dev.depjenga.sources;

import com.fasterxml.jackson.databind.JsonNode;
import dev.depjenga.analysis.AnalysisException;
import dev.depjenga.analysis.SourceLog;
import dev.depjenga.http.Http;
import dev.depjenga.http.TtlCache;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class GitHubClient {
    public static final String API = "GitHub REST API";
    public static final String RAW = "GitHub raw content";
    public static final String ADVISORIES = "GitHub Advisory Database";

    public record RepoRef(String owner, String repo, String ref) {}

    public record TreeEntry(String path, long size) {}

    public record Tree(List<TreeEntry> entries, boolean truncated) {}

    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_.\\-]+");

    private final Http http;
    private final String token;
    private final TtlCache<JsonNode> advisoryCache = new TtlCache<>(6 * 3600_000L, 20_000);
    private volatile long advisoryRateLimitedUntil = 0;

    public GitHubClient(Http http, @Value("${depjenga.github-token:}") String token) {
        this.http = http;
        this.token = token == null || token.isBlank() ? null : token.trim();
    }

    public boolean hasToken() {
        return token != null;
    }

    public static RepoRef parse(String input) {
        if (input == null || input.isBlank()) throw new AnalysisException("Paste a GitHub repository URL, e.g. https://github.com/expressjs/express");
        String s = input.trim()
                .replaceFirst("^(https?://)?(www\\.)?github\\.com/", "")
                .replaceFirst("^git@github\\.com:", "")
                .replaceAll("[?#].*$", "")
                .replaceAll("/+$", "")
                .replaceAll("\\.git$", "");
        String[] parts = s.split("/");
        if (parts.length < 2 || !NAME.matcher(parts[0]).matches() || !NAME.matcher(parts[1]).matches()) {
            throw new AnalysisException("That doesn't look like a GitHub repository. Try owner/repo or https://github.com/owner/repo");
        }
        String ref = null;
        if (parts.length >= 4 && (parts[2].equals("tree") || parts[2].equals("blob"))) ref = parts[3];
        return new RepoRef(parts[0], parts[1], ref);
    }

    private Map<String, String> apiHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("Accept", "application/vnd.github+json");
        h.put("X-GitHub-Api-Version", "2022-11-28");
        if (token != null) h.put("Authorization", "Bearer " + token);
        return h;
    }

    /** Repository metadata, or null if the API is unavailable (e.g. rate limited). Throws if the repo does not exist. */
    public JsonNode repo(RepoRef ref, SourceLog log) {
        String url = "https://api.github.com/repos/" + ref.owner() + "/" + ref.repo();
        try {
            Http.Res r = http.get(url, apiHeaders());
            if (r.status() == 404) {
                log.fail(API, "Repository not found");
                throw new AnalysisException("Repository " + ref.owner() + "/" + ref.repo() + " was not found (or it is private).");
            }
            if (!r.ok()) {
                log.fail(API, r.status() == 403 || r.status() == 429
                        ? "Rate limited (unauthenticated limit is 60 requests/hour; set GITHUB_TOKEN to raise it)"
                        : "HTTP " + r.status());
                return null;
            }
            log.ok(API);
            return http.mapper().readTree(r.body());
        } catch (IOException e) {
            log.fail(API, e.getMessage());
            return null;
        }
    }

    public Tree tree(RepoRef ref, String branch, SourceLog log) {
        String url = "https://api.github.com/repos/" + ref.owner() + "/" + ref.repo() + "/git/trees/" + Http.enc(branch) + "?recursive=1";
        try {
            JsonNode n = http.getJson(url, apiHeaders());
            if (n == null) {
                log.fail(API, "Branch/ref '" + branch + "' not found");
                return null;
            }
            log.ok(API);
            List<TreeEntry> entries = new ArrayList<>();
            for (JsonNode e : n.path("tree")) {
                if ("blob".equals(e.path("type").asText())) entries.add(new TreeEntry(e.path("path").asText(), e.path("size").asLong()));
            }
            return new Tree(entries, n.path("truncated").asBoolean(false));
        } catch (IOException e) {
            log.fail(API, e.getMessage());
            return null;
        }
    }

    /** Raw file content via raw.githubusercontent.com (not subject to the REST API rate limit). Null if absent. */
    public String raw(RepoRef ref, String branch, String path, SourceLog log) {
        String encPath = Arrays.stream(path.split("/")).map(Http::enc).collect(Collectors.joining("/"));
        String url = "https://raw.githubusercontent.com/" + ref.owner() + "/" + ref.repo() + "/" + Http.enc(branch) + "/" + encPath;
        try {
            Http.Res r = http.get(url, token != null ? Map.of("Authorization", "Bearer " + token) : Map.of());
            if (r.status() == 404) return null;
            if (!r.ok()) {
                log.fail(RAW, "HTTP " + r.status() + " for " + path);
                return null;
            }
            log.ok(RAW);
            return r.body();
        } catch (IOException e) {
            log.fail(RAW, e.getMessage());
            return null;
        }
    }

    /**
     * GitHub-reviewed advisory by GHSA id. Returns null if unavailable. Once rate limited we stop calling
     * for a while instead of hammering the API.
     */
    public JsonNode advisory(String ghsaId, SourceLog log) {
        Optional<JsonNode> cached = advisoryCache.get(ghsaId);
        if (cached != null) return cached.orElse(null);
        if (System.currentTimeMillis() < advisoryRateLimitedUntil) return null;
        try {
            Http.Res r = http.get("https://api.github.com/advisories/" + Http.enc(ghsaId), apiHeaders());
            if (r.status() == 404) {
                log.ok(ADVISORIES);
                advisoryCache.put(ghsaId, null);
                return null;
            }
            if (r.status() == 403 || r.status() == 429) {
                advisoryRateLimitedUntil = System.currentTimeMillis() + 10 * 60_000L;
                log.fail(ADVISORIES, "Rate limited — remaining advisories use OSV's copy of the GitHub severity. Set GITHUB_TOKEN for full enrichment.");
                return null;
            }
            if (!r.ok()) {
                log.fail(ADVISORIES, "HTTP " + r.status());
                return null;
            }
            log.ok(ADVISORIES);
            JsonNode n = http.mapper().readTree(r.body());
            advisoryCache.put(ghsaId, n);
            return n;
        } catch (IOException e) {
            log.fail(ADVISORIES, e.getMessage());
            return null;
        }
    }
}
