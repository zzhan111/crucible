import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ContractSchema } from './src/contract/schema.js';
import { compileContract } from './src/contract/compiler.js';
import { createJudgeAugmentedScorer } from './src/scorer/augmented.js';
import { loadContract } from './src/contract/validate.js';

const raw = parse(readFileSync('v01-example.yaml','utf8'));
const r1 = ContractSchema.safeParse(raw);
console.log('v0.1 as-is parse ok?', r1.success, r1.success ? '' : r1.error.issues.map(i=>i.message).join('; '));
raw.rubric[0].weight = 1.0;
const c = ContractSchema.parse(raw);
console.log('after weight fix keys:', Object.keys(c), 'hard[0] keys:', Object.keys(c.hard_constraints[0]), 'rubric[0] keys:', Object.keys(c.rubric[0]), 'fields[0] keys:', Object.keys(c.fields[0]));
const comp = compileContract(c);
console.log('predicates', comp.deterministicPredicateCount, 'detRubrics', comp.deterministicRubricCount, 'warnings', comp.warnings);
const art = { family: 'table', nodes: [{ order_qty: 9999, sales_30d: 1 }] } as any;
const rep = await createJudgeAugmentedScorer(comp, c).score(art);
console.log('violating row:', JSON.stringify({det: rep.deterministic.deterministic_score, judge: rep.judge, final: rep.final_score}));
// metadata on repo contract
const intel = loadContract('contracts/intel-table-v1.yaml') as any;
console.log('intel metadata after load:', intel.metadata);
// cache collision: two different YAML contracts, same artifact
const travel = loadContract('contracts/travel-sequence-v1.yaml');
const travelNoHard = { ...travel, hard_constraints: [] };
const { hk3DayBuggy } = await import('./src/fixtures/hk-3day-buggy.js').catch(()=>({} as any));
const buggy = hk3DayBuggy ?? Object.values(await import('./src/fixtures/hk-3day-buggy.js'))[0];
const a = await createJudgeAugmentedScorer(compileContract(travel), travel).score(buggy as any);
const b = await createJudgeAugmentedScorer(compileContract(travelNoHard), travelNoHard).score(buggy as any);
const bDirect = compileContract(travelNoHard).score(buggy as any);
console.log('cache: A hard=', a.deterministic.hard_violation_count, 'B(no hard) via cache hard=', b.deterministic.hard_violation_count, 'B direct det=', bDirect.deterministic.deterministic_score);
// v2-style rule on old engine
const v2rule = { ...c, hard_constraints: [{ id: 'x', type: 'primitive', primitive: 'range' }] };
const r3 = ContractSchema.safeParse(v2rule);
console.log('type:primitive on old schema ok?', r3.success);
// parseJudgeScore 1-5 scale
const { parseJudgeScore } = await import('./src/rubric/judge-types.js');
console.log('parse "5" ->', parseJudgeScore('5','d'), '"3" ->', parseJudgeScore('3','d'), '"On a scale of 0 to 1, 0.8" ->', parseJudgeScore('On a scale of 0 to 1, 0.8','d'));
// sandbox fail-open
const { runInSandbox } = await import('./src/contract/sandbox.js');
console.log('throwing predicate ->', JSON.stringify(runInSandbox('function check(a){ throw new Error("boom") }', art)));
// tau ties
const { kendallTau, rankingFromScores } = await import('./src/calibration/kendall_tau.js');
const r = rankingFromScores({a:0.5,b:0.5,c:0.5,d:0.5});
console.log('ties tau vs abcd', kendallTau(r,['a','b','c','d']).tau, 'vs dcba', kendallTau(r,['d','c','b','a']).tau);
