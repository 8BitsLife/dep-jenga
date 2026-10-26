import type { RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import type { BlockSpec } from './tower';

/**
 * Imperative bridge to the Rapier bodies. Blocks are dynamic but put to sleep on mount, so the stack is
 * perfectly still until disturbed. (Switching fixed -> dynamic at runtime produced bodies that sank
 * through each other and were then ejected; sleeping bodies keep valid contacts the whole time.)
 */
export const bodies = new Map<string, RapierRigidBody>();
export const specs = new Map<string, BlockSpec>();
export const camera: { current: THREE.Camera | null } = { current: null };

export function wakeAll() {
  bodies.forEach((b) => b.wakeUp());
}

function longAxis(spec: BlockSpec) {
  return spec.rotationY === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
}

export function pull(id: string) {
  const b = bodies.get(id);
  const spec = specs.get(id);
  if (!b || !spec) return;
  wakeAll();
  const axis = longAxis(spec);
  const t = b.translation();
  const pos = new THREE.Vector3(t.x, t.y, t.z);
  if (camera.current) {
    const toCam = camera.current.position.clone().sub(pos);
    if (toCam.dot(axis) < 0) axis.negate();
  }
  const m = b.mass();
  b.enableCcd(true);
  // "grease" the block while it slides out, the way a careful player taps a Jenga block free;
  // the rest of the tower keeps real friction, so whatever it was holding up reacts honestly
  const collider = b.collider(0);
  collider?.setFriction(0.02);
  collider?.setFrictionCombineRule(1); // CoefficientCombineRule.Min — otherwise Rapier averages with the neighbours
  setTimeout(() => {
    collider?.setFriction(0.75);
    collider?.setFrictionCombineRule(0); // back to Average
  }, 1400);
  b.applyImpulse({ x: axis.x * 8 * m, y: 0.4 * m, z: axis.z * 8 * m }, true);
  b.applyTorqueImpulse({ x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * 2 * m, z: (Math.random() - 0.5) * m }, true);
}

export function detonate(id: string, affected: Set<string>) {
  wakeAll();
  const center = bodies.get(id)?.translation();
  const kick = (b: RapierRigidBody, power: number) => {
    const t = b.translation();
    const dir = new THREE.Vector3(t.x, 0, t.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize();
    const m = b.mass();
    b.enableCcd(true);
    b.applyImpulse({ x: dir.x * power * m, y: (3 + Math.random() * 5) * m, z: dir.z * power * m }, true);
    b.applyTorqueImpulse({ x: (Math.random() - 0.5) * 3 * m, y: (Math.random() - 0.5) * 3 * m, z: (Math.random() - 0.5) * 3 * m }, true);
  };
  const target = bodies.get(id);
  if (target) kick(target, 24);
  affected.forEach((a) => {
    const b = bodies.get(a);
    if (!b) return;
    // closer to the epicentre = bigger kick
    const t = b.translation();
    const d = center ? Math.hypot(t.x - center.x, t.y - center.y, t.z - center.z) : 5;
    kick(b, 9 + 16 / (1 + d * 0.2));
  });
}

/** Share of blocks still close to where they were stacked (1 = pristine tower). */
export function integrity(): number {
  if (!bodies.size) return 1;
  let ok = 0;
  bodies.forEach((b, id) => {
    const s = specs.get(id);
    if (!s) return;
    const t = b.translation();
    const d = Math.hypot(t.x - s.position[0], t.y - s.position[1], t.z - s.position[2]);
    if (d < 0.6) ok++;
  });
  return ok / bodies.size;
}

if (import.meta.env.DEV) (window as unknown as { __physics: unknown }).__physics = { bodies, specs, wakeAll, integrity };
