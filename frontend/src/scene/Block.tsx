import { RoundedBox } from '@react-three/drei';
import { Select } from '@react-three/postprocessing';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import * as physics from '../lib/physics';
import { SEV_META } from '../lib/severity';
import { sfx } from '../lib/sound';
import type { BlockSpec } from '../lib/tower';
import { useStore } from '../store';
import { hatchTexture } from './textures';
import { hold } from './hold';
import { repulsion } from './field';

const DIM = new THREE.Color('#141216');

// landing tower palette, taken from the logo
const CREAM = '#ddd0c2';
const CHARCOAL = '#25222a';
const BRAND_RED = '#ff4436';
/** The one block on the landing tower that is half pulled out, like the logo. */
const HERO_INDEX = 23;
const tmp = new THREE.Color();
const _force = new THREE.Vector3();
const _world = new THREE.Vector3();
const _local = new THREE.Vector3();

// spring-damper tuned to be underdamped: blocks overshoot a little and settle back, like a nudged stack
const SPRING_K = 38;
const SPRING_C = 5.5;
const MAX_OFFSET = 1.7;

interface Props {
  spec: BlockSpec;
  decorative?: boolean;
}

export const Block = memo(function Block({ spec, decorative }: Props) {
  const rb = useRef<RapierRigidBody>(null);
  const visual = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  const born = useRef(performance.now());
  const landed = useRef(false);
  const wobble = useRef(0);
  const dimAmt = useRef(0);
  const slide = useRef(0);
  const kick = useRef(0);
  const off = useRef(new THREE.Vector3());
  const vel = useRef(new THREE.Vector3());
  const knocked = useRef(false);

  const pkg = spec.pkg;
  const sev = pkg?.severity ?? 'NONE';
  const meta = SEV_META[sev];
  const vulnerable = !!pkg && pkg.vulns.length > 0;
  const hatched = !decorative && (!spec.riskKnown || sev === 'NOT_SCANNED');
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  const decoIndex = decorative ? Number(spec.id.slice(5)) : -1;
  const isHero = decoIndex === HERO_INDEX;
  const home = useMemo(() => new THREE.Vector3(...spec.position), [spec.position]);
  const toLocal = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -spec.rotationY), [spec.rotationY]);

  const baseColor = useMemo(() => {
    if (decorative) {
      if (isHero) return new THREE.Color(BRAND_RED);
      const dark = (decoIndex * 7 + spec.layer * 3) % 5 === 0;
      return new THREE.Color(dark ? CHARCOAL : CREAM).offsetHSL(0, 0, (Math.random() - 0.5) * 0.025);
    }
    const c = new THREE.Color(sev === 'NONE' ? CREAM : meta.color);
    if (!vulnerable) c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
    return c;
  }, [decorative, isHero, decoIndex, spec.layer, meta.color, vulnerable, sev]);
  const emissive = useMemo(() => new THREE.Color(isHero ? BRAND_RED : vulnerable ? meta.color : CREAM), [isHero, vulnerable, meta.color]);

  const selected = useStore((s) => s.selectedId === spec.id);
  const hovered = useStore((s) => s.hoverId === spec.id);
  const inBlast = useStore((s) => s.blastSet.has(spec.id));
  const dimmed = useStore((s) => s.blastId != null && s.blastId !== spec.id && !s.blastSet.has(spec.id));

  useEffect(() => {
    if (decorative) return;
    const body = rb.current;
    if (body) {
      // dynamic-but-asleep: perfectly still until something disturbs it, then real physics
      body.sleep();
      physics.bodies.set(spec.id, body);
      physics.specs.set(spec.id, spec);
    }
    return () => {
      if (physics.bodies.get(spec.id) === body) physics.bodies.delete(spec.id);
    };
  }, [spec, decorative]);

  const delay = spec.layer * 42 + spec.slot * 16;

  useFrame((state, dt) => {
    const now = performance.now();
    const g = visual.current;
    if (g) {
      const k = Math.min(1, Math.max(0, (now - born.current - delay) / 520));
      // easeOutBack for a springy landing
      const c1 = 1.5;
      const e = k === 0 ? 0 : 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      g.visible = k > 0;
      g.position.y = (1 - e) * 12;
      if (k >= 1 && !landed.current) {
        landed.current = true;
        if (spec.slot === 1) sfx.tock(0.8 + (spec.layer % 5) * 0.08, 0.35);
      }
      if (isHero) {
        // the logo's red block: half out, eases further out on hover, pops on click
        const target = 1.15 + (hovered ? 0.55 : 0) + kick.current * 1.4;
        kick.current = Math.max(0, kick.current - dt * 1.6);
        slide.current = THREE.MathUtils.lerp(slide.current, target, 0.12);
        g.position.x = slide.current + Math.sin(state.clock.elapsedTime * 1.4) * 0.04;
      }
      if (wobble.current > 0) {
        wobble.current = Math.max(0, wobble.current - dt * 2.5);
        g.rotation.y = Math.sin(now * 0.04) * 0.08 * wobble.current;
        g.position.y += Math.abs(Math.sin(now * 0.03)) * 0.25 * wobble.current;
      }
      if (decorative && k >= 1) {
        // each block is a particle on a spring anchored at its slot; the cursor repels it
        const o = off.current, v = vel.current;
        const step = Math.min(dt, 1 / 30) / 2;
        for (let i = 0; i < 2; i++) {
          _world.copy(home).add(o);
          repulsion(_world, _force);
          v.x += (_force.x - SPRING_K * o.x - SPRING_C * v.x) * step;
          v.y += (_force.y - SPRING_K * o.y - SPRING_C * v.y) * step;
          v.z += (_force.z - SPRING_K * o.z - SPRING_C * v.z) * step;
          o.addScaledVector(v, step);
        }
        if (o.length() > MAX_OFFSET) o.setLength(MAX_OFFSET);
        const out = o.length();
        if (out > 0.32 && !knocked.current) {
          knocked.current = true;
          sfx.clack(Math.min(1, v.length() / 9) * 0.5);
        } else if (out < 0.12) knocked.current = false;
        _local.copy(o).applyQuaternion(toLocal);
        g.position.x = (isHero ? g.position.x : 0) + _local.x;
        g.position.y += _local.y;
        g.position.z = _local.z;
        // shoved blocks tilt in the direction they're pushed
        g.rotation.x = _local.z * 0.22;
        g.rotation.z = -_local.x * 0.22;
        if (wobble.current <= 0) g.rotation.y = _local.x * 0.05 - _local.z * 0.08;
      }
    }
    const m = mat.current;
    if (m) {
      const t = state.clock.elapsedTime;
      dimAmt.current = THREE.MathUtils.lerp(dimAmt.current, dimmed ? 0.82 : 0, 0.12);
      m.color.copy(tmp.copy(baseColor).lerp(DIM, dimAmt.current));
      let target: number;
      if (decorative) target = isHero ? 0.18 + 0.08 * Math.sin(t * 1.6) : 0;
      else {
        const speed = sev === 'CRITICAL' ? 4.2 : sev === 'HIGH' ? 3 : 2;
        target = vulnerable ? meta.glow * (0.6 + 0.4 * Math.sin(t * speed + phase)) : 0;
        if (inBlast) target = 1.4 + 0.9 * Math.sin(t * 9 + phase);
        target *= 1 - dimAmt.current * 0.9;
      }
      if (hovered) target += decorative ? 0.05 : 0.4;
      if (selected) target += 0.9;
      m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, target, 0.18);
      if (inBlast) m.emissive.set('#ff6a2a');
      else m.emissive.copy(emissive);
    }
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    useStore.getState().hover(spec.id);
    document.body.style.cursor = useStore.getState().tool === 'pull' ? 'grab' : 'pointer';
  };
  const onOut = () => {
    if (useStore.getState().hoverId === spec.id) useStore.getState().hover(undefined);
    document.body.style.cursor = '';
    if (hold.id === spec.id) hold.cancel();
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (decorative) return;
    if (useStore.getState().tool === 'pull') hold.begin(spec.id);
  };
  const onUp = () => {
    if (hold.id === spec.id) hold.cancel();
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 6) return; // was an orbit drag
    if (decorative) {
      if (isHero) {
        kick.current = 1;
        sfx.whoosh();
      } else {
        wobble.current = 1;
        sfx.tock(0.9 + Math.random() * 0.4);
      }
      return;
    }
    const s = useStore.getState();
    if (s.tool === 'blast') s.showBlast(spec.id);
    else if (s.tool === 'inspect') s.select(spec.id);
  };
  const onCollide = () => {
    if (!useStore.getState().awake || !rb.current) return;
    const v = rb.current.linvel();
    sfx.clack(Math.hypot(v.x, v.y, v.z) / 6);
  };

  const [l, h, w] = spec.size;
  return (
    <RigidBody
      ref={rb}
      type="dynamic"
      canSleep
      colliders={false}
      position={spec.position}
      rotation={[0, spec.rotationY, 0]}
      friction={0.75}
      restitution={0.04}
      linearDamping={0.08}
      angularDamping={0.15}
      onCollisionEnter={onCollide}
    >
      <CuboidCollider args={[l / 2, h / 2, w / 2]} />
      <group ref={visual} visible={false}>
        <Select enabled={selected || hovered}>
          <RoundedBox
            args={[l, h * 0.97, w]}
            radius={0.07}
            smoothness={3}
            castShadow
            receiveShadow
            onPointerOver={onOver}
            onPointerOut={onOut}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onClick={onClick}
          >
            <meshPhysicalMaterial
              ref={mat}
              color={baseColor}
              emissive={emissive}
              emissiveIntensity={0}
              roughness={vulnerable ? 0.38 : 0.58}
              metalness={0}
              clearcoat={0.35}
              clearcoatRoughness={0.45}
              map={hatched ? hatchTexture() : null}
            />
          </RoundedBox>
        </Select>
      </group>
    </RigidBody>
  );
});
