#!/usr/bin/env node
/**
 * 新疆 7 天环线攻略 — crucible 引擎迭代演示。
 *
 * 链路: xinjiang-travel-v1 契约 → 编译 scorer → v1(buggy) 评分 →
 *       runCrucibleWorkflow 3 轮迭代(Scorer/Critic/Apply/Curator) → v3 最终攻略。
 *
 * 用法: npm run xinjiang:travel
 *       (有 OPENAI_API_KEY 走真实 LLM judge; 无则 mock fallback, 引擎降级哲学)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { createJudgeAugmentedScorer } from '../src/scorer/augmented.js';
import { runCrucibleWorkflow } from '../src/workflow/crucible.js';
import { xinjiang7dayV1, xinjiang7dayV1TotalMinutes } from '../src/fixtures/xinjiang-7day-v1.js';
import { xinjiang7dayNorthV1, xinjiang7dayNorthV1TotalMinutes } from '../src/fixtures/xinjiang-7day-north-v1.js';
import { xinjiang7dayNorthV2, xinjiang7dayNorthV2TotalMinutes } from '../src/fixtures/xinjiang-7day-north-v2.js';
import type { Artifact } from '../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', 'contracts', 'xinjiang-travel-v1.yaml');

// --variant=north2 → 北线科学性修正版（v3），--variant=north → 北线 v2，默认伊犁线（v1）
const VARIANT = process.argv.includes('--variant=north2') ? 'north2' : process.argv.includes('--variant=north') ? 'north' : 'south';
const ARTIFACT = VARIANT === 'north2' ? xinjiang7dayNorthV2 : VARIANT === 'north' ? xinjiang7dayNorthV1 : xinjiang7dayV1;
const TOTAL_MIN = VARIANT === 'north2' ? xinjiang7dayNorthV2TotalMinutes : VARIANT === 'north' ? xinjiang7dayNorthV1TotalMinutes : xinjiang7dayV1TotalMinutes;
const ROUTE_LABEL = VARIANT === 'north2'
  ? '北线喀纳斯环线 v3(科学性修正): 144团 → 乌尔禾魔鬼城 → 布尔津 → 喀纳斯 → 禾木 → 可可托海 → 144团'
  : VARIANT === 'north'
    ? '北线喀纳斯环线: 144团 → 乌尔禾魔鬼城 → 布尔津 → 喀纳斯 → 禾木 → 可可托海 → 144团'
    : '伊犁环线: 144团 → 独山子 → 独库 → 那拉提 → 巴音布鲁克 → 赛里木湖 → 144团';

function section(title: string): void {
  console.log('\n' + '═'.repeat(64));
  console.log(title);
  console.log('═'.repeat(64));
}

function collectStates(artifact: Artifact): string[] {
  const set = new Set<string>();
  for (const n of artifact.nodes) {
    for (const s of (n.state as string[] | undefined) ?? []) set.add(s);
  }
  return [...set];
}

async function main(): Promise<void> {
  const contract = loadContract(CONTRACT);
  const baseScorer = compileContract(contract);
  const scorer = createJudgeAugmentedScorer(baseScorer, contract);

  section('Step 1 — v1 初稿评分（buggy, 信源驱动）');
  console.log(`路线: ${ROUTE_LABEL}`);
  console.log(`契约: xinjiang-travel-v1 | 谓词: ${baseScorer.deterministicPredicateCount} | det rubric: ${baseScorer.deterministicRubricCount}`);
  console.log(`LLM: ${process.env.OPENAI_API_KEY ? '已配置(真实 judge)' : '未配置(judge mock fallback)'}`);
  console.log(`v1 全程总时长: ${TOTAL_MIN} min (预算 5040 min)`);
  const report1 = await scorer.score(ARTIFACT);
  console.log(`v1 final=${report1.final_score.toFixed(3)} det=${report1.deterministic.deterministic_score.toFixed(3)} judge=${report1.judge ? report1.judge.overall_score.toFixed(3) : '—'}`);
  const hard = report1.deterministic.violations.filter(v => v.severity === 'hard');
  console.log(`v1 硬违规: ${hard.length}`);
  for (const v of hard) {
    console.log(`  [${v.constraint_id}] ${v.message} → ${v.fix_hint ?? ''}`);
  }

  section('Step 2 — 3 轮迭代 (Scorer → Critic → Apply → Curator)');
  const result = await runCrucibleWorkflow({
    artifact: ARTIFACT,
    contract,
    baseScorer,
    artifactId: `xinjiang-${VARIANT}-7day-v1`,
    knownStates: collectStates(ARTIFACT),
    minImprovement: 0, // 强制跑满 3 轮, 分数曲线完整
  });

  result.iterations.forEach((it, i) => {
    console.log(`  v${i + 1}  final=${it.score.toFixed(3)}  违规=${it.violations}  patches=${it.patchesApplied}`);
  });

  const final = result.finalArtifact;
  const finalTotal = final.nodes.reduce((s, n) => s + (typeof n.duration_min === 'number' ? n.duration_min : 0), 0);
  console.log(`\n最终 v${result.iterations.length}: ${final.nodes.length} 节点, 全程 ${finalTotal} min`);

  // 剩余违规明细（finalArtifact 用确定性 scorer 复评）
  const finalReport = baseScorer.score(final);
  const finalHard = finalReport.deterministic.violations.filter(v => v.severity === 'hard');
  if (finalHard.length === 0) {
    console.log('✓ 硬违规清零');
  } else {
    console.log(`剩余硬违规: ${finalHard.length}`);
    for (const v of finalHard) {
      console.log(`  [${v.constraint_id}] ${v.message}`);
    }
  }

  section('Step 3 — 最终攻略节点明细');
  for (const n of final.nodes) {
    const src = n.source ? ` | src=${n.source}` : '';
    const trust = n.source_trust !== undefined ? ` t=${n.source_trust}` : '';
    console.log(`  ${String(n.time_block).padEnd(14)} ${String(n.node_type).padEnd(16)} ${String(n.duration_min).padStart(4)}min  ${String(n.action).slice(0, 34)}${trust}${src.slice(0, 40)}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
