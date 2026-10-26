import { sfx } from '../lib/sound';

export const HOLD_MS = 650;

/** Hold-to-pull state, shared between blocks, the progress ring and the camera (which pauses while holding). */
export const hold = {
  id: null as string | null,
  start: 0,
  listeners: new Set<() => void>(),
  begin(id: string) {
    this.id = id;
    this.start = performance.now();
    this.emit();
  },
  cancel() {
    if (!this.id) return;
    this.id = null;
    this.emit();
  },
  progress() {
    return this.id ? Math.min(1, (performance.now() - this.start) / HOLD_MS) : 0;
  },
  tickSound() {
    if (this.id) sfx.charge(this.progress());
  },
  emit() {
    this.listeners.forEach((l) => l());
  },
};
