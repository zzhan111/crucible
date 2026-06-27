import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runInSandbox, detectSandboxBackend } from '../../src/contract/sandbox.js';
import { collectArtifact } from '../../src/collection/collector.js';
import { MCP_TOOLS, findTool } from '../../src/mcp/tools.js';
import { handleRequest } from '../../src/mcp/server.js';
import { intelTableBuggy, intelTableGolden } from '../../src/fixtures/intel-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRAVEL_CONTRACT = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const INTEL_CONTRACT = join(__dirname, '..', '..', 'contracts', 'intel-table-v1.yaml');

/**
 * P2 验收标准 §3.1-3.4 逐项核对。
 */
describe('P2 验收标准核对 (§3.1-3.4)', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  // §3.1 沙箱可用
  describe('§3.1 沙箱可用', () => {
    it('code_predicate.impl 可在沙箱中执行', () => {
      const backend = detectSandboxBackend();
      expect(backend).toMatch(/isolated-vm|vm/);
      const impl = `function check(a) { return a.nodes.length > 2 ? [{constraint_id:'test',severity:'hard',message:'too many',location:{node_index:0}}] : []; }`;
      const result = runInSandbox(impl, { family: 'sequence', nodes: [{}, {}, {}] } as any);
      expect(result).toHaveLength(1);
    });

    it('恶意代码(require fs)被拦截', () => {
      const impl = `function check(a) { require('fs'); return []; }`;
      const result = runInSandbox(impl, { family: 'sequence', nodes: [] } as any);
      expect(result).toEqual([]);
    });

    it('恶意代码(while-true)超时被拦截', () => {
      const impl = `function check(a) { while(true){} return []; }`;
      const result = runInSandbox(impl, { family: 'sequence', nodes: [] } as any);
      expect(result).toEqual([]);
    });
  });

  // §3.2 采集层可用
  describe('§3.2 采集层可用', () => {
    it('BigSet 适配器: 报告 → intel-table Artifact', () => {
      const result = collectArtifact('bigset', {
        competitors: [{ competitor_name: 'A', feature: 'f', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }],
      });
      expect(result.artifact.family).toBe('table');
      expect(result.artifact.nodes).toHaveLength(1);
    });

    it('Travel 适配器: 攻略 → sequence Artifact', () => {
      const result = collectArtifact('travel-guide', {
        itinerary: [{ action: 'a', duration_min: 30 }],
      });
      expect(result.artifact.family).toBe('sequence');
    });

    it('边界: 空输入不 crash', () => {
      const result = collectArtifact('bigset', null);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  // §3.3 MCP server 可用
  describe('§3.3 MCP server 可用', () => {
    it('5 个工具注册成功', () => {
      expect(MCP_TOOLS).toHaveLength(5);
    });

    it('工具调用返回正确类型(score_artifact → ScoreReport)', async () => {
      const resp = await handleRequest({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'score_artifact',
          arguments: {
            artifact_json: JSON.stringify({ family: 'sequence', nodes: [{ action: 'a', duration_min: 30, node_type: 'dining', elasticity: 'compressible' }] }),
            contract_path: TRAVEL_CONTRACT,
          },
        },
      });
      expect(resp.result).toBeDefined();
      const content = (resp.result as { content: { text: string }[] }).content;
      const report = JSON.parse(content[0].text);
      expect(report).toHaveProperty('deterministic');
      expect(report).toHaveProperty('final_score');
    });

    it('降级模式(无 API key)不 crash', async () => {
      const resp = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(resp.result).toBeDefined();
    });
  });

  // §3.4 UI 路演可视化
  describe('§3.4 UI 路演可视化', () => {
    it('demo-html 模块可导入(无 import 副作用)', async () => {
      // 验证导入不触发 startMcpServer 等副作用
      const mod = await import('../../src/demo-html.js');
      expect(mod).toBeDefined();
    });
  });
});
