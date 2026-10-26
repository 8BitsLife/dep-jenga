import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import * as physics from '../lib/physics';
import { useStore } from '../store';

const SEGMENTS = 22;
const MAX_LINES = 90;

/** Glowing arcs from the blast epicentre to every dependent block, with sparks travelling along them. */
export function BlastLines() {
  const blastId = useStore((s) => s.blastId);
  const blastSet = useStore((s) => s.blastSet);
  const targets = useMemo(() => [...blastSet].filter((id) => physics.bodies.has(id)).slice(0, MAX_LINES), [blastSet]);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINES * SEGMENTS * 2 * 3), 3));
    const colors = new Float32Array(MAX_LINES * SEGMENTS * 2 * 3);
    const a = new THREE.Color('#ffb02e'), b = new THREE.Color('#ff2e88'), c = new THREE.Color();
    for (let l = 0; l < MAX_LINES; l++) {
      for (let s = 0; s < SEGMENTS; s++) {
        for (let k = 0; k < 2; k++) {
          c.copy(a).lerp(b, (s + k) / SEGMENTS);
          const i = ((l * SEGMENTS + s) * 2 + k) * 3;
          colors[i] = c.r * 2.2;
          colors[i + 1] = c.g * 2.2;
          colors[i + 2] = c.b * 2.2;
        }
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);

  const sparks = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.LineBasicMaterial>(null);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const offsets = useMemo(() => targets.map(() => Math.random()), [targets]);

  useFrame(({ clock }) => {
    if (!blastId) return;
    const src = physics.bodies.get(blastId)?.translation();
    if (!src) return;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const p = new THREE.Vector3();
    targets.forEach((id, l) => {
      const t = physics.bodies.get(id)?.translation();
      if (!t) return;
      curve.v0.set(src.x, src.y, src.z);
      curve.v2.set(t.x, t.y, t.z);
      const mid = curve.v0.clone().add(curve.v2).multiplyScalar(0.5);
      const outward = new THREE.Vector3(mid.x, 0, mid.z);
      if (outward.lengthSq() < 0.01) outward.set(1, 0, 0);
      outward.normalize().multiplyScalar(2.5 + curve.v0.distanceTo(curve.v2) * 0.35);
      curve.v1.copy(mid).add(outward).add(new THREE.Vector3(0, 0.8, 0));
      for (let s = 0; s < SEGMENTS; s++) {
        curve.getPoint(s / SEGMENTS, p);
        let i = (l * SEGMENTS + s) * 6;
        arr[i] = p.x; arr[i + 1] = p.y; arr[i + 2] = p.z;
        curve.getPoint((s + 1) / SEGMENTS, p);
        arr[i + 3] = p.x; arr[i + 4] = p.y; arr[i + 5] = p.z;
        i += 6;
      }
      if (sparks.current) {
        const u = (clock.elapsedTime * 0.55 + offsets[l]) % 1;
        curve.getPoint(u, p);
        dummy.position.copy(p);
        dummy.scale.setScalar(0.09 + 0.05 * Math.sin(u * Math.PI));
        dummy.updateMatrix();
        sparks.current.setMatrixAt(l, dummy.matrix);
      }
    });
    pos.needsUpdate = true;
    geom.setDrawRange(0, targets.length * SEGMENTS * 2);
    if (sparks.current) {
      sparks.current.count = targets.length;
      sparks.current.instanceMatrix.needsUpdate = true;
    }
    if (mat.current) mat.current.opacity = 0.55 + 0.25 * Math.sin(clock.elapsedTime * 5);
  });

  if (!blastId || targets.length === 0) return null;
  return (
    <group>
      <lineSegments geometry={geom} frustumCulled={false}>
        <lineBasicMaterial ref={mat} vertexColors transparent toneMapped={false} depthWrite={false} />
      </lineSegments>
      <instancedMesh ref={sparks} args={[undefined, undefined, MAX_LINES]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={[4, 2.2, 1.2]} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
