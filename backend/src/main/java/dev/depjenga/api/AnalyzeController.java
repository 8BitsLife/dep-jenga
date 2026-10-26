package dev.depjenga.api;

import dev.depjenga.analysis.AnalysisException;
import dev.depjenga.analysis.AnalysisService;
import dev.depjenga.model.Model.AnalysisResult;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
public class AnalyzeController {
    private static final Logger log = LoggerFactory.getLogger(AnalyzeController.class);

    private final AnalysisService service;

    public AnalyzeController(AnalysisService service) {
        this.service = service;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "service", "depjenga");
    }

    /** Plain JSON variant (handy for curl / scripting). */
    @GetMapping("/api/analyze")
    public AnalysisResult analyze(@RequestParam String repo, @RequestParam(defaultValue = "false") boolean fresh) {
        return service.analyze(repo, fresh, (stage, msg, pct) -> {});
    }

    /** Server-sent events: `progress` events while working, then one `result` (or `failure`) event. */
    @GetMapping(path = "/api/analyze/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestParam String repo, @RequestParam(defaultValue = "false") boolean fresh) {
        SseEmitter em = new SseEmitter(300_000L);
        Thread.ofVirtual().start(() -> {
            try {
                AnalysisResult r = service.analyze(repo, fresh, (stage, msg, pct) ->
                        send(em, "progress", Map.of("stage", stage, "message", msg, "pct", pct)));
                send(em, "result", r);
                em.complete();
            } catch (AnalysisException e) {
                send(em, "failure", Map.of("message", e.getMessage()));
                em.complete();
            } catch (Exception e) {
                log.error("analysis failed for {}", repo, e);
                send(em, "failure", Map.of("message", "Unexpected server error: " + e.getMessage()));
                em.complete();
            }
        });
        return em;
    }

    private static void send(SseEmitter em, String name, Object data) {
        try {
            em.send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON));
        } catch (IOException | IllegalStateException ignored) {
            // client went away
        }
    }

    @ExceptionHandler(AnalysisException.class)
    public ResponseEntity<Map<String, String>> onAnalysis(AnalysisException e) {
        return ResponseEntity.badRequest().body(Map.of("message", e.getMessage()));
    }
}
