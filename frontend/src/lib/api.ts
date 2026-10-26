import type { AnalysisResult, ProgressEvent } from './types';

export interface StreamHandlers {
  onProgress: (e: ProgressEvent) => void;
  onResult: (r: AnalysisResult) => void;
  onError: (message: string) => void;
}

/** Opens the SSE analysis stream. Returns a cancel function. */
export function analyzeRepo(repo: string, fresh: boolean, h: StreamHandlers): () => void {
  const url = `/api/analyze/stream?repo=${encodeURIComponent(repo)}${fresh ? '&fresh=true' : ''}`;
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
    h.onError('Lost connection to the DepJenga backend. Is it running on port 8080?');
  };
  return () => {
    finished = true;
    es.close();
  };
}
