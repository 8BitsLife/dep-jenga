import * as THREE from 'three';

let hatch: THREE.CanvasTexture | null = null;

/** Diagonal hazard hatching = "data unavailable" across the whole app. */
export function hatchTexture() {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#8c8c9c';
  g.lineWidth = 14;
  for (let i = -128; i < 256; i += 36) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
  }
  hatch = new THREE.CanvasTexture(c);
  hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping;
  hatch.repeat.set(3, 1);
  hatch.colorSpace = THREE.SRGBColorSpace;
  return hatch;
}
