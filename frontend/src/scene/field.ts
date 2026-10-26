import * as THREE from 'three';

/**
 * Cursor force field for the landing tower. The pointer is treated as a ray from the camera; blocks near
 * that ray are pushed away from it. Faster cursor movement pushes harder, so a lazy hover nudges the tower
 * and a quick swipe scatters it.
 */
export const field = {
  ray: new THREE.Ray(),
  /** smoothed cursor speed in normalized device units per second */
  speed: 0,
  active: false,
  reducedMotion: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
};

export const FIELD_RADIUS = 3.4;

const closest = new THREE.Vector3();
const away = new THREE.Vector3();

/** Repulsion force on a point (world space), written into `out`. Returns the force magnitude. */
export function repulsion(p: THREE.Vector3, out: THREE.Vector3): number {
  out.set(0, 0, 0);
  if (!field.active || field.reducedMotion) return 0;
  field.ray.closestPointToPoint(p, closest);
  away.subVectors(p, closest);
  const d = away.length();
  if (d > FIELD_RADIUS) return 0;
  if (d < 1e-3) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
  away.normalize();
  away.y *= 0.35; // blocks mostly scatter sideways, like they're being brushed
  const falloff = Math.pow(1 - d / FIELD_RADIUS, 2);
  const strength = falloff * (24 + Math.min(field.speed, 6) * 20);
  out.copy(away).multiplyScalar(strength);
  return strength;
}

if (import.meta.env.DEV) (window as unknown as { __field: typeof field }).__field = field;
