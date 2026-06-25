/**
 * Crucible P0 Demo — 三段式路演验证
 *
 * 1. 展示契约:打印 Contract YAML 摘要
 * 2. 跑分抓 bug:喂 hk3dayBuggy,Scorer 抓出 3 个违规
 * 3. 提分迭代:v1→v2→v3,分数曲线上升 + Curator proposal
 *
 * 运行:npx tsx src/demo.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from './contract/validate.js';
import { compileContract } from './contract/compiler.js';
import { createJudgeAugmentedScorer } from './scorer/augmented.js';
import { runCrucibleWorkflow } from './workflow/crucible.js';
import { hk3dayBuggy } from './fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from './fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', 'contracts', 'travel-sequence-v1.yaml');

async function main() {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  console.log('='.repeat(70));
  console.log('Crucible P0 Demo — 契约驱动合成引擎');
  console.log('='.repeat(70));
  console.log(`Mode: ${hasApiKey ? 'LLM judge (OpenRouter)' : 'Degraded (judge=neutral 0.5)'}`);
  console.log();

  console.log('Section 1: Contract v1.0');
  console.log('-'.repeat(70));
  const contract = loadContract(CONTRACT_PATH);
  console.log(`Artifact family: ${contract.artifact_family}`);
  console.log(`Fields: ${contract.fields.length}`);
  console.log(`  ${contract.fields.map(f => f.name).join(', ')}`);
  console.log(`Hard constraints: ${contract.hard_constraints.length}`);
  for (const c of contract.hard_constraints) {
    const detail = c.type === 'declarative'
      ? (c.mutex ? `mutex: [${c.mutex.join(', ')}]` : (c.rule ?? ''))
      : `code_predicate: ${c.impl}`;
    console.log(`  - ${c.id}: ${detail}`);
  }
  console.log(`Rubric: ${contract.rubric.length} dims`);
  for (const r of contract.rubric) {
    console.log(`  - ${r.dim} (weight=${r.weight}, mode=${r.mode})`);
  }
  console.log();

  console.log('Section 2: Score + catch bugs');
  console.log('-'.repeat(70));
  const baseScorer = compileContract(contract);
  const augmentedScorer = createJudgeAugmentedScorer(baseScorer, contract);

  console.log('\nGolden artifact (no bugs):');
  const goldenReport = await augmentedScorer.score(hk3dayGolden);
  console.log(`  final_score: ${goldenReport.final_score.toFixed(4)}`);
  console.log(`  deterministic_score: ${goldenReport.deterministic.deterministic_score.toFixed(4)}`);
  console.log(`  hard_violations: ${goldenReport.deterministic.hard_violation_count}`);
  console.log(`  judge_overall: ${goldenReport.judge?.overall_score.toFixed(4) ?? 'N/A'}`);

  console.log('\nBuggy artifact (3 injected bugs):');
  const buggyReport = await augmentedScorer.score(hk3dayBuggy);
  console.log(`  final_score: ${buggyReport.final_score.toFixed(4)}`);
  console.log(`  deterministic_score: ${buggyReport.deterministic.deterministic_score.toFixed(4)}`);
  console.log(`  hard_violations: ${buggyReport.deterministic.hard_violation_count}`);
  console.log(`  judge_overall: ${buggyReport.judge?.overall_score.toFixed(4) ?? 'N/A'}`);
  console.log('\nViolations caught:');
  for (const v of buggyReport.deterministic.violations) {
    console.log(`  X [${v.constraint_id}] ${v.message}`);
    console.log(`    fix_hint: ${v.fix_hint}`);
  }
  console.log(`\nScore: golden ${goldenReport.final_score.toFixed(4)} > buggy ${buggyReport.final_score.toFixed(4)}`);
  console.log();

  console.log('Section 3: Iterative improvement');
  console.log('-'.repeat(70));
  console.log('\nStarting workflow (v1 buggy -> Critic -> v2 -> v3, max 3 rounds)...');

  const result = await runCrucibleWorkflow({
    artifact: hk3dayBuggy,
    contract,
    baseScorer,
    artifactId: 'demo-run',
    knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
  });

  console.log('\nIteration results:');
  console.log('  Round | Score   | Violations | Patches');
  console.log('  ------|---------|------------|--------');
  for (let i = 0; i < result.iterations.length; i++) {
    const iter = result.iterations[i];
    console.log(`  v${i + 1}    | ${iter.score.toFixed(4)} | ${iter.violations}          | ${iter.patchesApplied}`);
  }
  console.log();
  console.log(`Final score: ${result.finalScore.toFixed(4)}`);
  console.log(`Final violations: ${result.iterations[result.iterations.length - 1].violations}`);
  console.log(`Curator proposals: ${result.proposals}`);

  console.log('\nScore curve:');
  const scores = result.iterations.map(i => i.score);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore || 1;
  for (let i = 0; i < scores.length; i++) {
    const bars = Math.round((scores[i] - minScore) / range * 30) + 1;
    console.log(`  v${i + 1} ${'#'.repeat(bars)}${'.'.repeat(31 - bars)} ${scores[i].toFixed(4)}`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('Demo complete. One-liner:');
  console.log('  "Agents coordinate via an executable contract,');
  console.log('   not chat messages — auto-discovering defects,');
  console.log('   auto-improving scores."');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
