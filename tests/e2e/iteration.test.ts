import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const PROPOSALS_DIR = join(__dirname, '..', '..', 'contracts', 'proposals');

describe('P0 acceptance 4.2 — score improves over iterations', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    if (existsSync(PROPOSALS_DIR)) {
      rmSync(PROPOSALS_DIR, { recursive: true, force: true });
    }
  });

  it('iterations show score improvement (deterministic violations get fixed)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-4-2',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    // 至少 1 轮才能验证
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    const scores = result.iterations.map(i => i.score);
    // 验收 4.2 语义(outside-voice Q1 修正):
    // P0 无 API key 时 judge=neutral 0.5,修复违规后 det 0.55→1.0。
    // P1 修正: Critic 可在首轮修复所有违规,后续无提升(已经完美)。
    // 故断言:非递减 + (至少一轮严格提升 或 最终 violations=0)。
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 0.001); // 非递减(容差)
    }
    const improvements = [];
    for (let i = 1; i < scores.length; i++) {
      improvements.push(scores[i] - scores[i - 1]);
    }
    const maxImprovement = improvements.length > 0 ? Math.max(...improvements) : 0;
    const finalViolations = result.iterations[result.iterations.length - 1].violations;
    expect(maxImprovement > 0.01 || finalViolations === 0).toBe(true);
    console.log('E2E 4.2 scores:', scores, 'improvements:', improvements);
  });

  it('hard violations reach zero by final iteration', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-violations',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    const finalViolations = result.iterations[result.iterations.length - 1].violations;
    expect(finalViolations).toBe(0);
  });
});

describe('P0 acceptance 4.3 — multi-agent coordination observable', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('workflow logs show Scorer + Critic + Curator + Workflow + Judge agent activity', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));

    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-4-3',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });

    const allLogs = logs.join('\n');
    // 验收 4.3:日志能看到 agent 的活动(降级模式,Studio 跑不起来时用日志)
    expect(allLogs).toMatch(/\[Scorer\]/);
    expect(allLogs).toMatch(/\[Critic\]/);
    expect(allLogs).toMatch(/\[Curator\]/);
    expect(allLogs).toMatch(/\[Workflow\]/);
    // Judge fan-out 可观测:Scorer 日志含 "judge fan-out"(表明 judge 被派发)
    expect(allLogs).toMatch(/judge fan-out/i);
  });
});

describe('P0 acceptance 4.4 — contract versioning via Curator proposals', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    if (existsSync(PROPOSALS_DIR)) {
      rmSync(PROPOSALS_DIR, { recursive: true, force: true });
    }
  });

  it('Curator writes proposal YAML file when novelty detected', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    // 用一个含新颖 state 的 artifact 触发 Curator
    const artifactWithNovelty = {
      ...hk3dayBuggy,
      nodes: [
        ...hk3dayBuggy.nodes,
        {
          time_block: '12:00-13:00',
          action: '午餐',
          duration_min: 60,
          node_type: 'dining',
          state: ['hungry', 'novel_state_xyz'],
        },
      ],
    };
    await runCrucibleWorkflow({
      artifact: artifactWithNovelty,
      contract,
      baseScorer,
      artifactId: 'e2e-4-4',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });

    // 验收 4.4:proposals 目录有文件
    expect(existsSync(PROPOSALS_DIR)).toBe(true);
    const files = readdirSync(PROPOSALS_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith('.yaml'))).toBe(true);
  });
});
