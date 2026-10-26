import type { AnalysisResult, PackageNode } from './types';
import { sevRank } from './severity';

export interface GraphIndex {
  byId: Map<string, PackageNode>;
  parents: Map<string, string[]>; // who depends on me (excluding ROOT)
  children: Map<string, string[]>;
  rootChildren: string[];
}

export function indexGraph(r: AnalysisResult): GraphIndex {
  const byId = new Map(r.packages.map((p) => [p.id, p]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const rootChildren: string[] = [];
  for (const e of r.edges) {
    if (e.from === r.rootId) {
      rootChildren.push(e.to);
      continue;
    }
    if (!parents.has(e.to)) parents.set(e.to, []);
    parents.get(e.to)!.push(e.from);
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
  }
  return { byId, parents, children, rootChildren };
}

/** Every package that (transitively) depends on `id` — what gets compromised if `id` is. */
export function blastRadius(g: GraphIndex, id: string): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of g.parents.get(cur) ?? []) {
      if (!seen.has(p) && p !== id) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  return seen;
}

/** Shortest chain from the project root to `id`, e.g. [express, body-parser, qs]. */
export function pathFromRoot(g: GraphIndex, id: string): string[] {
  const prev = new Map<string, string | null>();
  const queue: string[] = [];
  for (const c of g.rootChildren) {
    if (!prev.has(c)) {
      prev.set(c, null);
      queue.push(c);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === id) break;
    for (const c of g.children.get(cur) ?? []) {
      if (!prev.has(c)) {
        prev.set(c, cur);
        queue.push(c);
      }
    }
  }
  if (!prev.has(id)) return [id];
  const path: string[] = [];
  let cur: string | null = id;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return path;
}

export function threatOrder(a: PackageNode, b: PackageNode) {
  return sevRank(a.severity) - sevRank(b.severity) || (b.maxCvss ?? 0) - (a.maxCvss ?? 0) || b.transitiveDependents - a.transitiveDependents;
}
