package dev.depjenga.http;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Component;

/** Thin JDK HttpClient wrapper with per-host concurrency limits and retry on 429/5xx. */
@Component
public class Http {

    public record Res(int status, String body, java.net.http.HttpHeaders headers) {
        public boolean ok() {
            return status >= 200 && status < 300;
        }
    }

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();
    private final ObjectMapper om;
    private final Map<String, Semaphore> hostLimits = new ConcurrentHashMap<>();

    public Http(ObjectMapper om) {
        this.om = om;
    }

    public ObjectMapper mapper() {
        return om;
    }

    private static int limitFor(String host) {
        if (host.contains("deps.dev")) return 24;
        if (host.contains("osv.dev")) return 12;
        if (host.contains("npmjs")) return 12;
        if (host.equals("api.github.com")) return 6;
        return 8;
    }

    public Res send(String method, String url, Map<String, String> headers, String body) throws IOException {
        URI uri = URI.create(url);
        Semaphore sem = hostLimits.computeIfAbsent(uri.getHost(), h -> new Semaphore(limitFor(h)));
        IOException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpResponse<String> r;
            try {
                sem.acquire();
                try {
                    HttpRequest.Builder b = HttpRequest.newBuilder(uri)
                            .timeout(Duration.ofSeconds(30))
                            .header("User-Agent", "DepJenga/1.0 (dependency security visualizer)");
                    headers.forEach(b::header);
                    if (body != null) {
                        b.header("Content-Type", "application/json");
                        b.method(method, HttpRequest.BodyPublishers.ofString(body));
                    } else {
                        b.method(method, HttpRequest.BodyPublishers.noBody());
                    }
                    r = client.send(b.build(), HttpResponse.BodyHandlers.ofString());
                } finally {
                    sem.release();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("interrupted");
            } catch (IOException e) {
                last = e;
                pause(400L * (attempt + 1));
                continue;
            }
            boolean retryable = r.statusCode() == 429 || r.statusCode() >= 500;
            if (retryable && attempt < 2) {
                pause(600L * (attempt + 1));
                continue;
            }
            return new Res(r.statusCode(), r.body(), r.headers());
        }
        throw last != null ? last : new IOException("request failed: " + url);
    }

    public Res get(String url, Map<String, String> headers) throws IOException {
        return send("GET", url, headers, null);
    }

    /** GET returning parsed JSON, or null on 404. Throws on other failures. */
    public JsonNode getJson(String url, Map<String, String> headers) throws IOException {
        Res r = get(url, headers);
        if (r.status() == 404) return null;
        if (!r.ok()) throw new HttpStatusException(r.status(), url, r.body());
        return om.readTree(r.body());
    }

    public JsonNode getJson(String url) throws IOException {
        return getJson(url, Map.of());
    }

    public JsonNode postJson(String url, Object payload) throws IOException {
        Res r = send("POST", url, Map.of(), om.writeValueAsString(payload));
        if (!r.ok()) throw new HttpStatusException(r.status(), url, r.body());
        return om.readTree(r.body());
    }

    public static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static void pause(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static class HttpStatusException extends IOException {
        public final int status;

        public HttpStatusException(int status, String url, String body) {
            super("HTTP " + status + " from " + url + (body != null && body.length() < 300 ? ": " + body : ""));
            this.status = status;
        }
    }
}
