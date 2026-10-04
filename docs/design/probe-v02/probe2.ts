import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ContractV2 } from './schema-v2-draft.js';
import { ContractSchema } from './src/contract/schema.js';
import { compileContract } from './src/contract/compiler.js';
const raw = parse(readFileSync('v02-from-doc.yaml','utf8'));
const r = ContractV2.safeParse(raw);
console.log('v0.2 example vs draft v2 schema:', r.success, r.success ? '' : JSON.stringify(r.error.issues));
const bad = structuredClone(raw); bad.hard_constraints[0].primitve = 'typo';
console.log('typo key rejected by v2 strict:', !ContractV2.safeParse(bad).success);
const bad2 = structuredClone(raw); bad2.rubric[0].weight = 0.6;
console.log('weights!=1 rejected:', !ContractV2.safeParse(bad2).success);
const old = ContractSchema.safeParse(raw);
console.log('v0.2 example on CURRENT engine schema:', old.success, old.success ? '' : old.error.issues.map(i => i.path.join('.') + ': ' + i.message).join(' | '));
// v1 projection
const proj = { artifact_family: 'table', fields: raw.fields.map((f: any) => ({ name: f.name, type: f.type === 'boolean' ? 'string' : f.type, required: f.required })),
  hard_constraints: [{ id: 'qty_vs_30d_sales', type: 'declarative', rule: raw.hard_constraints[0].rule_text }],
  rubric: raw.rubric.map((d: any) => ({ dim: d.dim, weight: d.weight, mode: d.mode })),
  calibration: { frozen_golden_set: raw.calibration.golden_set_ref, metric: 'kendall_tau' } };
const p = ContractSchema.safeParse(proj);
console.log('v1 projection loads on current engine:', p.success);
const comp = compileContract(p.data!);
console.log('v1 projection compile: predicates', comp.deterministicPredicateCount, 'detRubrics', comp.deterministicRubricCount, 'warnings', comp.warnings.length);
const { createJudgeAugmentedScorer } = await import('./src/scorer/augmented.js');
const rep = await createJudgeAugmentedScorer(comp, p.data!).score({ family: 'table', nodes: [{ sku_id: 'A', order_qty: 9999, is_new_sku: false, sales_30d: 1 }] } as any);
console.log('v1 projection, violating row:', JSON.stringify({ det: rep.deterministic.deterministic_score, judge: rep.judge?.overall_score, final: rep.final_score }));
