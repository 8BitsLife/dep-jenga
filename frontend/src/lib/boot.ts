/** Resolves once the 3D scene has mounted (fonts, environment, physics wasm) and drawn a couple of frames. */
let ready = false;
const waiters: (() => void)[] = [];

export function markSceneReady() {
  if (ready) return;
  ready = true;
  waiters.splice(0).forEach((w) => w());
}

export function whenSceneReady(): Promise<void> {
  return ready ? Promise.resolve() : new Promise((res) => waiters.push(res));
}
