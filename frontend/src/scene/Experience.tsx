import { CameraControls, Environment, Html, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, Outline, Selection, Vignette } from '@react-three/postprocessing';
import { CuboidCollider, Physics, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as physics from '../lib/physics';
import { SEV_META } from '../lib/severity';
import { decorativeTower, towerHeight } from '../lib/tower';
import { useStore } from '../store';
import { BlastLines } from './BlastLines';
import { Block } from './Block';
import { field } from './field';
import { hold } from './hold';

export const STUDIO = '#141216';

export function Experience() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [16, 12, 16], fov: 34, near: 0.1, far: 400 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onPointerMissed={() => {
        const s = useStore.getState();
        if (s.tool === 'inspect') s.select(undefined);
        if (s.tool === 'blast') s.showBlast(undefined);
      }}
    >
      <color attach="background" args={[STUDIO]} />
      <fog attach="fog" args={[STUDIO, 30, 95]} />
      <Suspense fallback={null}>
        <Selection>
          <SceneContents />
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.15} intensity={0.9} radius={0.6} />
            <Outline visibleEdgeColor={0xf3e6dc} hiddenEdgeColor={0xff4436} edgeStrength={5} blur width={1200} />
            <Vignette offset={0.3} darkness={0.55} />
            <Noise opacity={0.02} />
          </EffectComposer>
        </Selection>
      </Suspense>
    </Canvas>
  );
}

function SceneContents() {
  const phase = useStore((s) => s.phase);
  const blocks = useStore((s) => s.blocks);
  const towerKey = useStore((s) => s.towerKey);
  const deco = useMemo(() => decorativeTower(12), []);
  const showData = phase === 'ready' && blocks.length > 0;
  const shown = showData ? blocks : deco;
  const h = towerHeight(shown);

  return (
    <>
      <Lights height={h} />
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2} position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[24, 24, 1]} />
        <Lightformer intensity={1.4} color="#ffe9dc" position={[-14, 5, 4]} rotation-y={Math.PI / 2} scale={[12, 8, 1]} />
        <Lightformer intensity={0.8} color="#dfe6ff" position={[14, 5, -4]} rotation-y={-Math.PI / 2} scale={[12, 8, 1]} />
      </Environment>
      <Floor />
      <Physics key={towerKey} gravity={[0, -9.81, 0]} erp={0.1} numAdditionalFrictionIterations={4}>
        <Ground />
        {shown.map((b) => (
          <Block key={b.id} spec={b} decorative={!showData} />
        ))}
        {showData && <IntegrityMonitor />}
      </Physics>
      {showData && <BlastLines />}
      {showData && <Overlays />}
      {!showData && <PointerField />}
      <CameraRig height={h} landing={!showData} />
    </>
  );
}

/** Product-photography lighting: warm key, cool fill, soft rim. No colored gels on the blocks. */
function Lights({ height }: { height: number }) {
  return (
    <>
      <ambientLight intensity={0.25} />
      <hemisphereLight args={['#fff4ea', '#1a1618', 0.4]} />
      <spotLight
        position={[9, height + 16, 13]}
        angle={0.48}
        penumbra={1}
        intensity={680}
        decay={2}
        color="#fff2e6"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-radius={8}
      />
      <directionalLight position={[-12, height * 0.6 + 4, 6]} intensity={0.85} color="#dfe6ff" />
      <pointLight position={[-6, height + 4, -12]} intensity={160} color="#ffd9c7" distance={60} decay={2} />
    </>
  );
}

let poolTex: THREE.CanvasTexture | null = null;
function lightPool() {
  if (poolTex) return poolTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,236,224,0.55)');
  grad.addColorStop(0.45, 'rgba(255,220,205,0.16)');
  grad.addColorStop(1, 'rgba(255,220,205,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

/** Seamless studio sweep: the floor matches the backdrop and fades into fog, with a soft pool of light under the tower. */
function Floor() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[120, 64]} />
        <meshStandardMaterial color={STUDIO} roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]}>
        <planeGeometry args={[26, 26]} />
        <meshBasicMaterial map={lightPool()} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Feeds the landing tower's cursor force field: the pointer ray and how fast the cursor is moving. */
function PointerField() {
  const gl = useThree((s) => s.gl);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const last = useRef(new THREE.Vector2(9, 9));
  useEffect(() => {
    const el = gl.domElement;
    const enter = () => (field.active = true);
    const leave = () => {
      field.active = false;
      field.speed = 0;
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', enter);
    el.addEventListener('pointerleave', leave);
    return () => {
      leave();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', enter);
      el.removeEventListener('pointerleave', leave);
    };
  }, [gl]);
  useFrame(({ pointer, camera }, dt) => {
    raycaster.setFromCamera(pointer, camera);
    field.ray.copy(raycaster.ray);
    const moved = last.current.distanceTo(pointer);
    last.current.copy(pointer);
    const instant = moved > 1 ? 0 : moved / Math.max(dt, 1 / 240);
    field.speed = THREE.MathUtils.lerp(field.speed, instant, instant > field.speed ? 0.5 : 0.08);
  });
  return null;
}

/** Kinematic ground so "Quake" can literally shake the table. */
function Ground() {
  const ref = useRef<RapierRigidBody>(null);
  useFrame(({ clock }) => {
    const b = ref.current;
    if (!b) return;
    const until = useStore.getState().quakeUntil;
    const left = until - performance.now();
    if (left > 0) {
      const fade = Math.min(1, left / 900);
      const t = clock.elapsedTime;
      // lateral-only P/S-wave mix: topples the stack instead of launching it
      const ramp = Math.min(1, (3200 - left) / 600);
      const a = 0.07 * fade * ramp;
      b.setNextKinematicTranslation({ x: Math.sin(t * 13) * a + Math.sin(t * 29) * a * 0.3, y: 0, z: Math.cos(t * 11) * a * 0.8 });
    } else {
      b.setNextKinematicTranslation({ x: 0, y: 0, z: 0 });
    }
  });
  return (
    <RigidBody ref={ref} type="kinematicPosition" colliders={false}>
      <CuboidCollider args={[80, 0.5, 80]} position={[0, -0.5, 0]} friction={1} />
    </RigidBody>
  );
}

function IntegrityMonitor() {
  const acc = useRef(0);
  const { world } = useRapier();
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __world: unknown }).__world = world;
  }, [world]);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.35) return;
    acc.current = 0;
    if (!useStore.getState().awake) return;
    useStore.getState().setIntegrity(physics.integrity());
  });
  return null;
}

function CameraRig({ height, landing }: { height: number; landing: boolean }) {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const lastInput = useRef(0);
  const selectedId = useStore((s) => s.selectedId);
  const towerKey = useStore((s) => s.towerKey);

  useEffect(() => {
    physics.camera.current = camera;
  }, [camera]);

  // frame the tower whenever it changes
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const h = Math.max(height, 4);
    const wide = size.width > 900;
    const dist = Math.max(18, h * 1.5 + 12) * (landing ? (wide ? 1.4 : 2.1) : 1.18);
    c.setLookAt(dist * 0.72, h * 0.5 + 5, dist * 0.72, 0, h * 0.42, 0, true);
    // screen-space offset: keeps the tower beside the copy / panels while it orbits
    // analysis view: centre the tower in the space between the left panel and the right edge
    const fx = wide ? (landing ? -dist * 0.15 : -dist * 0.09) : 0;
    // on phones the landing tower is a hero image in the top third, above the copy
    const fy = !wide && landing ? dist * 0.15 : 0;
    c.setFocalOffset(fx, fy, 0, true);
  }, [towerKey, landing, height, size.width]);

  // glide toward the selected block
  useEffect(() => {
    const c = ref.current;
    if (!c || !selectedId) return;
    const b = physics.bodies.get(selectedId);
    if (!b) return;
    const t = b.translation();
    c.setTarget(t.x * 0.4, THREE.MathUtils.lerp(Math.max(height, 4) * 0.45, t.y, 0.45), t.z * 0.4, true);
  }, [selectedId, height]);

  useEffect(() => {
    const l = () => {
      if (ref.current) ref.current.enabled = !hold.id;
    };
    hold.listeners.add(l);
    return () => void hold.listeners.delete(l);
  }, []);

  useFrame((_, dt) => {
    const c = ref.current;
    if (!c) return;
    if (performance.now() - lastInput.current > 5000 && !hold.id) c.rotate(dt * (landing ? 0.09 : 0.035), 0, false);
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={4}
      maxDistance={140}
      maxPolarAngle={Math.PI * 0.485}
      smoothTime={0.35}
      draggingSmoothTime={0.12}
      onStart={() => (lastInput.current = performance.now())}
      onEnd={() => (lastInput.current = performance.now())}
    />
  );
}

/** Screen-space chips that follow physics bodies: hover tooltip, selection label, hold-to-pull ring. */
function Overlays() {
  const hoverId = useStore((s) => s.hoverId);
  const selectedId = useStore((s) => s.selectedId);
  const graph = useStore((s) => s.graph);
  const [holding, setHolding] = useState<string | null>(null);
  useEffect(() => {
    const l = () => setHolding(hold.id);
    hold.listeners.add(l);
    return () => void hold.listeners.delete(l);
  }, []);

  return (
    <>
      {hoverId && hoverId !== selectedId && graph?.byId.get(hoverId) && <Follow id={hoverId} kind="hover" />}
      {selectedId && graph?.byId.get(selectedId) && <Follow id={selectedId} kind="selected" />}
      {holding && <HoldRing id={holding} />}
    </>
  );
}

function useFollow(id: string, yOffset: number) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const b = physics.bodies.get(id);
    if (!b || !group.current) return;
    const t = b.translation();
    group.current.position.set(t.x, t.y + yOffset, t.z);
  });
  return group;
}

function Follow({ id, kind }: { id: string; kind: 'hover' | 'selected' }) {
  const group = useFollow(id, 0.75);
  const p = useStore((s) => s.graph?.byId.get(id));
  if (!p) return null;
  const meta = SEV_META[p.severity];
  return (
    <group ref={group}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`tag3d ${kind}`} style={{ ['--sev' as string]: meta.color }}>
          <span className="tag3d-dot" />
          <span className="tag3d-name">{p.name}</span>
          <span className="tag3d-ver">{p.version ?? 'unresolved'}</span>
          {p.vulns.length > 0 && <span className="tag3d-sev">{meta.short} · {p.vulns.length}</span>}
        </div>
      </Html>
    </group>
  );
}

function HoldRing({ id }: { id: string }) {
  const group = useFollow(id, 0);
  const circle = useRef<SVGCircleElement>(null);
  const fired = useRef(false);
  useFrame(() => {
    const p = hold.progress();
    hold.tickSound();
    if (circle.current) circle.current.style.strokeDashoffset = String(176 * (1 - p));
    if (p >= 1 && !fired.current && hold.id === id) {
      fired.current = true;
      hold.cancel();
      useStore.getState().pull(id);
    }
  });
  return (
    <group ref={group}>
      <Html center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <svg width="72" height="72" viewBox="0 0 72 72" className="hold-ring">
          <circle cx="36" cy="36" r="28" className="hold-ring-bg" />
          <circle ref={circle} cx="36" cy="36" r="28" className="hold-ring-fg" strokeDasharray="176" strokeDashoffset="176" />
        </svg>
      </Html>
    </group>
  );
}
