import { CameraControls, Environment, Grid, Html, Lightformer, MeshReflectorMaterial, Sparkles, Stars } from '@react-three/drei';
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
import { hold } from './hold';

export function Experience() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [16, 12, 16], fov: 38, near: 0.1, far: 400 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onPointerMissed={() => {
        const s = useStore.getState();
        if (s.tool === 'inspect') s.select(undefined);
        if (s.tool === 'blast') s.showBlast(undefined);
      }}
    >
      <color attach="background" args={['#07060d']} />
      <fog attach="fog" args={['#07060d', 38, 150]} />
      <Suspense fallback={null}>
        <Selection>
          <SceneContents />
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={1.15} radius={0.72} />
            <Outline visibleEdgeColor={0xffffff} hiddenEdgeColor={0x7a5cff} edgeStrength={6} blur width={1200} />
            <Vignette offset={0.22} darkness={0.72} />
            <Noise opacity={0.028} />
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
  const deco = useMemo(() => decorativeTower(15), []);
  const showData = phase === 'ready' && blocks.length > 0;
  const shown = showData ? blocks : deco;
  const h = towerHeight(shown);

  return (
    <>
      <Lights height={h} />
      <Environment resolution={256} frames={1}>
        <Lightformer intensity={2.2} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer intensity={2.4} color="#8a5cff" position={[-12, 4, -6]} rotation-y={Math.PI / 2} scale={[10, 6, 1]} />
        <Lightformer intensity={2.4} color="#4a63ff" position={[12, 4, -6]} rotation-y={-Math.PI / 2} scale={[10, 6, 1]} />
        <Lightformer intensity={1.2} color="#ffe7c4" position={[0, 3, 12]} scale={[14, 3, 1]} />
      </Environment>
      <Stars radius={140} depth={60} count={2600} factor={4.2} saturation={0.4} fade speed={0.5} />
      <Sparkles count={70} scale={[16, Math.max(12, h + 6), 16]} position={[0, Math.max(6, h / 2), 0]} size={2.2} speed={0.25} opacity={0.5} color="#b9a6ff" />
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
      <CameraRig height={h} landing={!showData} />
    </>
  );
}

function Lights({ height }: { height: number }) {
  return (
    <>
      <ambientLight intensity={0.22} />
      <hemisphereLight args={['#8a7dff', '#120a20', 0.45]} />
      <spotLight
        position={[10, height + 18, 12]}
        angle={0.5}
        penumbra={1}
        intensity={760}
        decay={2}
        color="#fff1df"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-14, height * 0.6 + 2, -8]} intensity={200} color="#8a5cff" distance={70} decay={2} />
      <pointLight position={[14, height * 0.4 + 2, -10]} intensity={200} color="#4a63ff" distance={70} decay={2} />
      <pointLight position={[0, 1.2, 0]} intensity={30} color="#7a5cff" distance={14} decay={2} />
    </>
  );
}

function Floor() {
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.opacity = 0.55 + 0.3 * Math.sin(clock.elapsedTime * 1.6);
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[90, 64]} />
        <MeshReflectorMaterial
          blur={[400, 120]}
          resolution={1024}
          mixBlur={1}
          mixStrength={22}
          roughness={1}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#0b0914"
          metalness={0.55}
          mirror={0}
        />
      </mesh>
      <Grid
        position={[0, 0.003, 0]}
        args={[120, 120]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#2a2350"
        sectionSize={6}
        sectionThickness={1}
        sectionColor="#5b45d6"
        fadeDistance={70}
        fadeStrength={1.6}
        infiniteGrid
      />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]}>
        <ringGeometry args={[3.1, 3.24, 96]} />
        <meshBasicMaterial ref={ring} color="#9b7bff" transparent toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.008, 0]}>
        <ringGeometry args={[4.1, 4.15, 96]} />
        <meshBasicMaterial color="#ff2e88" transparent opacity={0.35} toneMapped={false} />
      </mesh>
    </group>
  );
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
    const dist = Math.max(17, h * 1.5 + 12);
    const wide = size.width > 900;
    const tx = landing && wide ? -5.5 : 0;
    const ox = !landing && wide ? -h * 0.18 : 0;
    c.setLookAt(dist * 0.72 + tx + ox, h * 0.55 + 4, dist * 0.72 - ox, tx + ox, h * 0.45, 0, true);
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
