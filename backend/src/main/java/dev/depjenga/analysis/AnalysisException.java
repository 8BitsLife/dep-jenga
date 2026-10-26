package dev.depjenga.analysis;

/** A user-facing failure: its message is shown verbatim in the UI. */
public class AnalysisException extends RuntimeException {
    public AnalysisException(String message) {
        super(message);
    }
}
