import type { PackageNode } from './types';
import { isVulnerable } from './severity';

export const BLOCK_L = 3.6; // long side
export const BLOCK_H = 0.55;
export const BLOCK_W = 1.2; // nominal width (a layer is 3 widths = 1 length)
// 24 layers: close to a real Jenga tower's proportions instead of a needle
export const MAX_BLOCKS = 72;

export interface BlockSpec {
  id: string;
  pkg: PackageNode | null; // null on the decorative landing tower
  layer: number;
  slot: number;
  position: [number, number, number];
  rotationY: number;
  size: [number, number, number]; // x (length), y (height), z (width) before rotation
  riskKnown: boolean;
}

/**
 * Picks which packages become blocks and stacks them Jenga-style. Foundations (most depended-upon)
 * go at the bottom. Width shrinks with maintainer / bus-factor risk: risky packages literally weaken
 * the tower. Packages without risk data keep full width and get a hatched "unavailable" texture.
 */
export function layoutTower(packages: PackageNode[]): { blocks: BlockSpec[]; omitted: number } {
  const priority = [...packages].sort(
    (a, b) =>
      Number(isVulnerable(b)) - Number(isVulnerable(a)) ||
      Number(b.direct) - Number(a.direct) ||
      b.transitiveDependents - a.transitiveDependents ||
      (b.risk.score ?? 0) - (a.risk.score ?? 0),
  );
  const chosen = priority.slice(0, MAX_BLOCKS);
  chosen.sort((a, b) => b.transitiveDependents - a.transitiveDependents || b.depth - a.depth || a.name.localeCompare(b.name));
  const blocks = chosen.map((p, i) => spec(p.id, p, i, p.risk.available ? p.risk.score ?? 0 : null));
  return { blocks, omitted: Math.max(0, packages.length - chosen.length) };
}

export function decorativeTower(layers: number): BlockSpec[] {
  const out: BlockSpec[] = [];
  for (let i = 0; i < layers * 3; i++) out.push(spec(`deco-${i}`, null, i, 0));
  return out;
}

function spec(id: string, pkg: PackageNode | null, i: number, risk: number | null): BlockSpec {
  const layer = Math.floor(i / 3);
  const slot = i % 3;
  const alongX = layer % 2 === 0;
  const widthFactor = risk == null ? 1 : 1 - (risk / 100) * 0.5; // 1.0 .. 0.5
  const lengthFactor = risk == null ? 1 : 1 - (risk / 100) * 0.12;
  const w = BLOCK_W * widthFactor * 0.97;
  const l = BLOCK_L * lengthFactor * 0.995;
  const offset = (slot - 1) * BLOCK_W;
  const y = BLOCK_H / 2 + layer * (BLOCK_H + 0.002);
  return {
    id,
    pkg,
    layer,
    slot,
    position: alongX ? [0, y, offset] : [offset, y, 0],
    rotationY: alongX ? 0 : Math.PI / 2,
    size: [l, BLOCK_H, w],
    riskKnown: risk != null,
  };
}

export const towerHeight = (blocks: BlockSpec[]) => (blocks.length ? (Math.ceil(blocks.length / 3) * BLOCK_H) : 0);
