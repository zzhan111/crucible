import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
const c = loadContract('./contracts/xinjiang-travel-v1.yaml');
const s = compileContract(c);
const w = c.rubric.reduce((a: number, r: any) => a + r.weight, 0);
process.stdout.write(`OK family=${c.artifact_family} predicates=${s.deterministicPredicateCount} detRubric=${s.deterministicRubricCount} weights=${w}\n`);
