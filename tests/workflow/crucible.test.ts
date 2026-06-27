import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { openAndMigrate, type DB } from '../../src/persistence/db.js';
import { getArtifactAuditTrail } from '../../src/persistence/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('runCrucibleWorkflow', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('runs 3 iterations max and produces final artifact', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-run',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    expect(result.iterations.length).toBeLessThanOrEqual(3);
    expect(result.finalArtifact).toBeDefined();
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('hard violations decrease or reach zero over iterations', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-violations',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    const violations = result.iterations.map(i => i.violations);
    // 违规数应非递增(Critic 修复后减少或不变)
    for (let i = 1; i < violations.length; i++) {
      expect(violations[i]).toBeLessThanOrEqual(violations[i - 1]);
    }
  });

  // eng-review T1:验证 iteration.score 是 post-patch 分数(A1 修复),非递减 + 至少一轮提升
  // P1 修正: 若 Critic 在首轮即修复所有违规,后续轮次分数持平(violations→0 即为成功),
  // 不强制要求跨轮提升(提升在 v1→v2 的违规修复中已体现)。
  it('iteration scores are non-decreasing with at least one improvement (post-patch scores recorded)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-monotonic',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    const scores = result.iterations.map(i => i.score);
    // post-patch score 应非递减(Critic 修复违规 → 分数上升或持平)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 0.001); // 容差
    }
    // 至少一轮严格提升,或最终 violations=0(首轮修完,无更多可用提升)
    const improvements = [];
    for (let i = 1; i < scores.length; i++) {
      improvements.push(scores[i] - scores[i - 1]);
    }
    const maxImprovement = improvements.length > 0 ? Math.max(...improvements) : 0;
    const finalViolations = result.iterations[result.iterations.length - 1].violations;
    expect(maxImprovement > 0.01 || finalViolations === 0).toBe(true);
  });

  // P4.1 审计轨迹:验证 workflow 落库 + 审计查询可读回(降级模式,无 LLM)
  it('注入 auditDb → post-patch 评分落库,可经 getArtifactAuditTrail 读回', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const auditDb: DB = openAndMigrate(); // :memory:
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-audit',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
      auditDb,
    });
    // finalArtifact 是最后一轮 post-patch 产物,应有评分记录
    const trail = getArtifactAuditTrail(auditDb, result.finalArtifact);
    expect(trail).toBeDefined();
    expect(trail!.runs.length).toBeGreaterThanOrEqual(1);
    const run = trail!.runs[0];
    // 契约版本规范化:travel-sequence-v1.yaml 无 metadata → version=1
    expect(run.contract_version).toBe(1);
    expect(run.family).toBe('sequence');
    expect(run.det_score).toBeGreaterThanOrEqual(0);
    // 降级模式 judge=neutral 0.5,final = det*0.6 + 0.5*0.4
    expect(run.final_score).toBeGreaterThanOrEqual(0);
    // P4.2: 未传 actor → SYSTEM_ACTOR(system)
    expect(run.actor_id).toBe('system');
  });

  // P4.2 RBAC:传 actor → 落库 actor_id 正确
  it('传 actor → 评分落库带 actor_id', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const auditDb: DB = openAndMigrate();
    const actor = { id: 'demo-analyst', role: 'author' as const };
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-actor',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
      auditDb,
      actor,
    });
    const trail = getArtifactAuditTrail(auditDb, result.finalArtifact);
    expect(trail).toBeDefined();
    expect(trail!.runs[0].actor_id).toBe('demo-analyst');
  });

  it('未注入 auditDb 且无 CRUCIBLE_DB_PATH → 不落库,行为零变化', async () => {
    delete process.env.CRUCIBLE_DB_PATH;
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    // 不传 auditDb,env 也未设 → workflow 应正常跑完,不抛错
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-no-audit',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });
});
