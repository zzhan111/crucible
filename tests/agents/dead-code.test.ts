import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { createAgentRegistry } from '../../src/agents/registry.js';
import { judgeFanOut } from '../../src/agents/judge.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

/**
 * P1 §2.9 技术债:dead code 覆盖测试。
 * judgeFanOut 和 createAgentRegistry 在 P0 降级模式下未被 workflow 调用,
 * 但作为公共 API 保留(P2 Mastra 升级时复用)。加测试确保不腐化。
 */
describe('P1 §2.9 dead code 覆盖', () => {
  const contract = loadContract(CONTRACT_PATH);

  it('createAgentRegistry 返回 3 个 agent(scorer + judge + contractAuthor)', () => {
    const registry = createAgentRegistry();
    expect(registry.scorer).toBeDefined();
    expect(registry.judge).toBeDefined();
    expect(registry.contractAuthor).toBeDefined();
    expect(registry.scorer.name).toBe('scorer');
    expect(registry.judge.name).toBe('judge');
    expect(registry.contractAuthor.name).toBe('contract-author');
  });

  it('judgeFanOut 返回 RubricScore[](委托 fanoutJudges)', async () => {
    const scores = await judgeFanOut(hk3dayGolden, contract);
    expect(Array.isArray(scores)).toBe(true);
    expect(scores.length).toBe(3); // routing + memorability + dining_fit
    const dims = scores.map(s => s.dim);
    expect(dims).toContain('routing');
    expect(dims).toContain('memorability');
    expect(dims).toContain('dining_fit');
  });

  it('judgeFanOut 降级模式(无 API key)返回 neutral 0.5', async () => {
    const scores = await judgeFanOut(hk3dayGolden, contract);
    for (const s of scores) {
      expect(s.score).toBe(0.5); // 无 API key → neutral
    }
  });
});
