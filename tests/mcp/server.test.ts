import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOLS, findTool } from '../../src/mcp/tools.js';
import { handleRequest } from '../../src/mcp/server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRAVEL_CONTRACT = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P2 §2.3 MCP server — 工具注册', () => {
  it('注册 5 个工具', () => {
    expect(MCP_TOOLS).toHaveLength(5);
    const names = MCP_TOOLS.map(t => t.name);
    expect(names).toContain('score_artifact');
    expect(names).toContain('run_workflow');
    expect(names).toContain('calibrate_judge');
    expect(names).toContain('evolve_contract');
    expect(names).toContain('ab_compare');
  });

  it('每个工具有 name + description + inputSchema', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toHaveProperty('type', 'object');
      expect(tool.inputSchema).toHaveProperty('properties');
    }
  });

  it('findTool 按名称查找', () => {
    expect(findTool('score_artifact')).toBeDefined();
    expect(findTool('nonexistent')).toBeUndefined();
  });
});

describe('P2 §2.3 MCP server — JSON-RPC 协议', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY; // 降级模式,避免真实 LLM
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  it('initialize 返回 server info + capabilities', async () => {
    const resp = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(resp.result).toHaveProperty('protocolVersion');
    expect(resp.result).toHaveProperty('serverInfo.name', 'crucible-mcp');
    expect(resp.result).toHaveProperty('capabilities.tools');
  });

  it('tools/list 返回 5 个工具', async () => {
    const resp = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (resp.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(5);
  });

  it('未知方法返回 error', async () => {
    const resp = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'unknown_method' });
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32601);
  });

  it('tools/call 未知工具返回 error', async () => {
    const resp = await handleRequest({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    });
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32601);
  });
});

describe('P2 §2.3 MCP server — 工具调用(降级模式)', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  const sampleArtifact = {
    family: 'sequence',
    metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
    nodes: [
      { time_block: '08:00-08:30', action: '早餐', duration_min: 30, node_type: 'dining', elasticity: 'compressible', cost: 50, source_trust: 0.8, state: ['at_hotel'] },
      { time_block: '08:30-09:00', action: '步行', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible', source_trust: 0.9, state: [] },
    ],
  };

  it('score_artifact 返回 ScoreReport', async () => {
    const resp = await handleRequest({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: {
        name: 'score_artifact',
        arguments: { artifact_json: JSON.stringify(sampleArtifact), contract_path: TRAVEL_CONTRACT },
      },
    });
    expect(resp.result).toBeDefined();
    const content = (resp.result as { content: { text: string }[] }).content;
    const report = JSON.parse(content[0].text);
    expect(report).toHaveProperty('deterministic');
    expect(report).toHaveProperty('final_score');
  });

  it('ab_compare 返回 ABResult', async () => {
    const resp = await handleRequest({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: {
        name: 'ab_compare',
        arguments: { champion_path: TRAVEL_CONTRACT, challenger_path: TRAVEL_CONTRACT },
      },
    });
    expect(resp.result).toBeDefined();
    const content = (resp.result as { content: { text: string }[] }).content;
    const result = JSON.parse(content[0].text);
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('champion_tau');
  });

  it('工具执行失败返回 error(无效 artifact JSON)', async () => {
    const resp = await handleRequest({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {
        name: 'score_artifact',
        arguments: { artifact_json: 'not valid json', contract_path: TRAVEL_CONTRACT },
      },
    });
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32603);
  });
});
