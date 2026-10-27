import type { AnalysisResult, ProgressEvent } from './types';

export interface StreamHandlers {
  onProgress: (e: ProgressEvent) => void;
  onResult: (r: AnalysisResult) => void;
  onError: (message: string) => void;
}

/**
 * Where the backend lives. Empty in development (Vite proxies /api to localhost:8080); in production set
 * VITE_API_URL to the deployed backend, e.g. https://depjenga-api.onrender.com
 */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

/**
 * Free hosting tiers put the backend to sleep when idle. Pinging it as the page opens means it is usually
 * awake by the time someone has typed a repository name.
 */
export function wakeBackend() {
  fetch(`${API_BASE}/api/health`, { cache: 'no-store' }).catch(() => {
    /* best effort: the real request reports any failure */
  });
}

/** Opens the SSE analysis stream. Returns a cancel function. */
export function analyzeRepo(repo: string, fresh: boolean, h: StreamHandlers): () => void {
  const url = `${API_BASE}/api/analyze/stream?repo=${encodeURIComponent(repo)}${fresh ? '&fresh=true' : ''}`;
  const es = new EventSource(url);
  let finished = false;
  es.addEventListener('progress', (e) => h.onProgress(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('result', (e) => {
    finished = true;
    es.close();
    h.onResult(JSON.parse((e as MessageEvent).data));
  });
  es.addEventListener('failure', (e) => {
    finished = true;
    es.close();
    h.onError(JSON.parse((e as MessageEvent).data).message);
  });
  es.onerror = () => {
    if (finished) return;
    finished = true;
    es.close();
    h.onError(
      API_BASE
        ? 'Lost connection to the DepJenga backend. It may be waking up from sleep: try again in a minute.'
        : 'Lost connection to the DepJenga backend. Is it running on port 8080?',
    );
  };
  return () => {
    finished = true;
    es.close();
  };
}
