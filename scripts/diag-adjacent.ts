import { xinjiang7dayNorthV2 } from '../src/fixtures/xinjiang-7day-north-v2.js';

const BRIDGE = new Set(['transit', 'switch']);
const nodes = xinjiang7dayNorthV2.nodes;
console.log(`total nodes: ${nodes.length}`);
let sum = 0;
nodes.forEach((n, i) => {
  sum += (n.duration_min as number) ?? 0;
  if (i < nodes.length - 1) {
    const a = String(n.node_type ?? '');
    const b = String(nodes[i + 1].node_type ?? '');
    if (!BRIDGE.has(a) && !BRIDGE.has(b)) {
      console.log(`NO-BRIDGE ${i}→${i + 1}: ${a}("${String(n.action).slice(0, 22)}") → ${b}("${String(nodes[i + 1].action).slice(0, 22)}")`);
    }
  }
});
console.log(`total duration: ${sum} min`);
