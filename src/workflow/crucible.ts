import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { ScoreReport } from '../scorer/types.js';
import type { ArtifactPatch } from '../patch/types.js';
import { scorerRun } from '../agents/scorer.js';
import { generatePatches } from '../agents/critic.js';
import { detectNovelty } from '../agents/curator.js';
import { applyPatches } from '../patch/apply.js';
import { writeProposal } from '../proposals/write.js';

const MAX_ITERATIONS = 3;
const MIN_IMPROVEMENT = 0.01;

export interface CrucibleRunInput {
  artifact: Artifact;
  contract: Contract;
  baseScorer: CompiledScorer;
  artifactId: string;
  knownStates: string[];
}

export interface CrucibleIteration {
  artifact: Artifact;
  score: number;
  violations: number;
  patchesApplied: number;
}

export interface CrucibleRunResult {
  iterations: CrucibleIteration[];
  finalArtifact: Artifact;
  finalScore: number;
  proposals: number;
}

/**
 * runCrucibleWorkflow: 完整迭代回路。
 * v1 → score → critic → v2 → score → critic → v3 → score
 * 终止:提升 < 0.01 或达 MAX_ITERATIONS。
 *
 * Score 跟踪(eng-review A1 修复):
 * 每轮 iteration 记录 post-patch score(即下一轮输入 artifact 的分数)。
 * - iteration[0].score = v1 patch 后的分数(= v2 输入的分数)
 * - iteration[1].score = v2 patch 后的分数(= v3 输入的分数)
 * 这样验收 4.2 比较相邻 iteration.score 就是"v2 vs v1"、"v3 vs v2",语义正确。
 * pre-patch score 只用于 Critic 决策(读 ScoreReport.violations),不记入 iteration。
 */
export async function runCrucibleWorkflow(input: CrucibleRunInput): Promise<CrucibleRunResult> {
  const allIterations: CrucibleIteration[] = [];
  let currentArtifact = input.artifact;
  let totalProposals = 0;
  let lastPostPatchScore = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`\n[Workflow] === Iteration ${i + 1}/${MAX_ITERATIONS} ===`);

    // 1. Score(pre-patch,用于 Critic 读 violations)
    console.log('[Workflow] Step 1: Scorer (pre-patch)');
    const prePatchReport = await scorerRun(currentArtifact, input.baseScorer, input.contract);

    // 2. Critic(读 pre-patch violations,生成 patch)
    console.log('[Workflow] Step 2: Critic');
    const patches = await generatePatches(prePatchReport, currentArtifact);

    // 3. Apply patches → post-patch artifact
    const postPatchArtifact = patches.length > 0
      ? applyPatches(currentArtifact, patches)
      : currentArtifact;

    // 4. Score(post-patch,记录到 iteration)
    console.log('[Workflow] Step 1b: Scorer (post-patch)');
    const postPatchReport = await scorerRun(postPatchArtifact, input.baseScorer, input.contract);

    // 记录本轮:artifact 是 pre-patch 的(展示原始输入),score 是 post-patch 的(展示修复效果)
    allIterations.push({
      artifact: currentArtifact,
      score: postPatchReport.final_score,
      violations: prePatchReport.deterministic.hard_violation_count,
      patchesApplied: patches.length,
    });

    // 5. Curator(检测 post-patch artifact 新颖度)
    console.log('[Workflow] Step 3: Curator');
    const proposals = await detectNovelty(postPatchArtifact, input.knownStates);
    for (const p of proposals) {
      writeProposal(p, input.artifactId);
    }
    totalProposals += proposals.length;

    // 6. 更新 currentArtifact 为 post-patch(下一轮输入)
    currentArtifact = postPatchArtifact;

    // 7. 终止条件:post-patch 提升 < MIN_IMPROVEMENT(比较本轮 post-patch vs 上轮 post-patch)
    if (i > 0 && allIterations.length >= 2) {
      const prevPostPatchScore = allIterations[allIterations.length - 2].score;
      const currPostPatchScore = allIterations[allIterations.length - 1].score;
      if (currPostPatchScore - prevPostPatchScore < MIN_IMPROVEMENT) {
        console.log(`[Workflow] improvement < ${MIN_IMPROVEMENT}, stopping`);
        break;
      }
    }
    lastPostPatchScore = postPatchReport.final_score;
  }

  return {
    iterations: allIterations,
    finalArtifact: currentArtifact,
    finalScore: lastPostPatchScore,
    proposals: totalProposals,
  };
}
