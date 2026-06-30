import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { ScoreReport } from '../scorer/types.js';
import type { ArtifactPatch } from '../patch/types.js';
import type { DB } from '../persistence/db.js';
import type { Actor } from '../auth/rbac.js';
import type { EnvHandle } from '../env/index.js';
import { SYSTEM_ACTOR } from '../auth/rbac.js';
import { scorerRun } from '../agents/scorer.js';
import { generatePatches } from '../agents/critic.js';
import { detectNovelty } from '../agents/curator.js';
import { applyPatches } from '../patch/apply.js';
import { writeProposal } from '../proposals/write.js';
import { openAuditDB } from '../persistence/db.js';
import { persistScoreRun } from '../persistence/sink.js';

const MAX_ITERATIONS = 3;
const MIN_IMPROVEMENT = 0.01;

export interface CrucibleRunInput {
  artifact: Artifact;
  contract: Contract;
  baseScorer: CompiledScorer;
  artifactId: string;
  knownStates: string[];
  /**
   * P4.1 审计轨迹落库 DB。未传则读 CRUCIBLE_DB_PATH(未设 → null,不落库)。
   * 测试可注入 :memory: DB 验证落库;生产靠 env 开关。
   */
  auditDb?: DB;
  /**
   * P4.2 RBAC:操作者标识(谁触发这次 workflow)。未传 → SYSTEM_ACTOR(system/admin)。
   * actor.id 落入 score_runs.actor_id,审计可追溯"谁评分"。
   */
  actor?: Actor;
  /**
   * §5: 可选 live env handle。未传 → 行为完全等同 P3.5(老路径)。
   * 传入 → 每轮迭代开始时调用 env.consume(artifact),把累积事件折叠进 artifact。
   */
  liveEnv?: EnvHandle;
}

export interface CrucibleIteration {
  artifact: Artifact;
  score: number;
  violations: number;
  patchesApplied: number;
  /** §5: 本轮 consume 折叠的事件 id 列表(空数组 = 未开 env 或本轮无事件)。 */
  consumedEventIds: string[];
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
  // P4.1: 审计落库(显式注入优先,否则读 env;未开 → null,行为零变化)
  const auditDb = input.auditDb !== undefined ? input.auditDb : openAuditDB();
  // P4.2: 操作者(未传 → SYSTEM_ACTOR,向后兼容)
  const actor = input.actor ?? SYSTEM_ACTOR;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`\n[Workflow] === Iteration ${i + 1}/${MAX_ITERATIONS} ===`);

    // §5: 轮间拉取 env 事件并折叠(env 未启用时 consume 是 no-op,但这里 liveEnv 未传则跳过)
    let consumedEventIds: string[] = [];
    if (input.liveEnv) {
      const envResult = input.liveEnv.consume(currentArtifact);
      currentArtifact = envResult.artifact;
      consumedEventIds = envResult.appliedEventIds;
    }

    // 1. Score(pre-patch,用于 Critic 读 violations)
    // eng-review C3 (P1 §2.9): Critic 只读 deterministic.violations,不需要 judge。
    // 用 baseScorer(纯确定性)而非 scorerRun(含 LLM judge),省一半 LLM 调用。
    console.log('[Workflow] Step 1: Scorer (pre-patch, deterministic only)');
    const prePatchReport = input.baseScorer.score(currentArtifact);

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

    // P4.1 审计轨迹:落库 post-patch 评分(最终判定分,含 judge)。
    // pre-patch(确定性 only)不落库 — 审计关注判定结果,不是中间诊断。
    // auditDb 为 null(未设 CRUCIBLE_DB_PATH)时跳过,行为零变化。
    // P4.2: 传 actor,记"谁触发的评分"。
    if (auditDb) {
      persistScoreRun(auditDb, postPatchArtifact, input.contract, postPatchReport, actor);
    }

    // 记录本轮:artifact 是 pre-patch 的(展示原始输入),score 是 post-patch 的(展示修复效果)
    allIterations.push({
      artifact: currentArtifact,
      score: postPatchReport.final_score,
      violations: prePatchReport.deterministic.hard_violation_count,
      patchesApplied: patches.length,
      consumedEventIds,
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
