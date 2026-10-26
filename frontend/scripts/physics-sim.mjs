// Headless stability check for the Jenga stack: same block sizes, spacing and material params as the app.
// usage: node scripts/physics-sim.mjs [blocks=108] [erp=0.1]   (try erp=0.8, @react-three/rapier's default)
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const L = 3.6, H = 0.55, W = 1.2, N = Number(process.argv[2] ?? 108);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.integrationParameters.erp = Number(process.argv[3] ?? 0.1);
world.integrationParameters.numAdditionalFrictionIterations = 4;
const ground = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0).setFriction(1), ground);
const bodies = [];
for (let i = 0; i < N; i++) {
  const layer = Math.floor(i / 3), slot = i % 3, alongX = layer % 2 === 0;
  const risk = (i * 37) % 100; // spread of widths like real data
  const w = W * (1 - (risk / 100) * 0.5) * 0.97, l = L * (1 - (risk / 100) * 0.12) * 0.995;
  const off = (slot - 1) * W, y = H / 2 + layer * (H + 0.002);
  const pos = alongX ? [0, y, off] : [off, y, 0];
  const q = alongX ? { x: 0, y: 0, z: 0, w: 1 } : { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...pos).setRotation(q).setLinearDamping(0.08).setAngularDamping(0.15));
  world.createCollider(RAPIER.ColliderDesc.cuboid(l / 2, H / 2, w / 2).setFriction(0.75).setRestitution(0.04), b);
  b.sleep();
  bodies.push({ b, pos });
}
for (let i = 0; i < 120; i++) world.step();
const asleep = bodies.filter(({ b }) => b.isSleeping()).length;
const drift = Math.max(...bodies.map(({ b, pos }) => Math.abs(b.translation().y - pos[1])));
console.log(`after 2s asleep: ${asleep}/${bodies.length}, max drift ${drift.toFixed(4)}`);
bodies.forEach(({ b }) => b.wakeUp());
for (let s = 1; s <= 240; s++) {
  world.step();
  if (s % 60 === 0) {
    let ok = 0, mx = 0;
    for (const { b, pos } of bodies) {
      const t = b.translation(), v = b.linvel();
      if (Math.hypot(t.x - pos[0], t.y - pos[1], t.z - pos[2]) < 0.6) ok++;
      mx = Math.max(mx, Math.hypot(v.x, v.y, v.z));
    }
    console.log(`t=${s / 60}s integrity=${Math.round((ok / bodies.length) * 100)}% maxV=${mx.toFixed(2)}`);
  }
}
