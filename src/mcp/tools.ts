/**
 * MCP 工具定义(P2 §2.3)。
 *
 * 每个工具: name + description + 参数 schema + handler。
 * handler 接收参数,返回 JSON-serializable 结果。
 */
import type { Artifact } from '../predicates/types.js';
import { loadContract } from '../contract/validate.js';
import { compileContract } from '../contract/compiler.js';
import { createJudgeAugmentedScorer } from '../scorer/augmented.js';
import { runCrucibleWorkflow } from '../workflow/crucible.js';
import { runJudgeCalibration, saveCalibrationReport } from '../calibration/calibrate.js';
import { contractAuthorRevise } from '../agents/contract-author.js';
import { detectNovelty } from '../agents/curator.js';
import { processGateDecision } from '../agents/human-gate.js';
import { applyContractPatch } from '../contract/patch.js';
import { runABComparison } from '../ab/comparison.js';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** 解析 artifact JSON 字符串 */
function parseArtifact(json: string): Artifact {
  const parsed = JSON.parse(json);
  if (!parsed || !Array.isArray(parsed.nodes)) {
    throw new Error('invalid artifact: missing nodes array');
  }
  return parsed as Artifact;
}

/** 工具: 对工件打分 */
const scoreArtifactTool: McpTool = {
  name: 'score_artifact',
  description: 'Score an artifact against a contract. Returns ScoreReport with deterministic + judge scores.',
  inputSchema: {
    type: 'object',
    properties: {
      artifact_json: { type: 'string', description: 'JSON string of the artifact to score' },
      contract_path: { type: 'string', description: 'Path to contract YAML file' },
    },
    required: ['artifact_json', 'contract_path'],
  },
  async handler(args) {
    const artifact = parseArtifact(String(args.artifact_json));
    const contract = loadContract(String(args.contract_path));
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    return await scorer.score(artifact);
  },
};

/** 工具: 运行完整迭代工作流 */
const runWorkflowTool: McpTool = {
  name: 'run_workflow',
  description: 'Run the full Crucible iterative workflow (v1→Critic→v2→v3). Returns iterations + final artifact + score.',
  inputSchema: {
    type: 'object',
    properties: {
      artifact_json: { type: 'string', description: 'JSON string of the starting (buggy) artifact' },
      contract_path: { type: 'string', description: 'Path to contract YAML file' },
      known_states: { type: 'array', items: { type: 'string' }, description: 'Known state tokens for Curator novelty detection' },
      session_token: { type: 'string', description: 'P4.2.5 RBAC: 会话 token(优先,经 IdentityProvider 解析 actor)。未传则用 actor_id/actor_role 回退' },
      actor_id: { type: 'string', description: 'P4.2 RBAC: 操作者标识(回退用,无 session_token 时生效)。默认 system' },
      actor_role: { type: 'string', enum: ['admin', 'author', 'approver', 'viewer'], description: 'P4.2 RBAC: 操作者角色(回退用)。默认 admin' },
    },
    required: ['artifact_json', 'contract_path'],
  },
  async handler(args) {
    const artifact = parseArtifact(String(args.artifact_json));
    const contract = loadContract(String(args.contract_path));
    const baseScorer = compileContract(contract);
    // P4.2.5: 优先从 session_token 解析 actor(经 IdentityProvider);无 token 或解析失败则回退 actor_id/actor_role
    let actor: { id: string; role: 'admin' | 'author' | 'approver' | 'viewer' };
    if (typeof args.session_token === 'string' && args.session_token) {
      const { openAuditDB } = await import('../persistence/db.js');
      const { StaticTokenProvider, resolveActorFromToken } = await import('../auth/identity-provider.js');
      const db = openAuditDB();
      if (db) {
        const provider = new StaticTokenProvider(db);
        const resolved = await resolveActorFromToken(db, provider, args.session_token);
        db.close();
        actor = resolved ?? { id: 'system', role: 'admin' };
      } else {
        // 无审计 DB(未设 CRUCIBLE_DB_PATH)→ token 无法解析,回退
        actor = { id: typeof args.actor_id === 'string' ? args.actor_id : 'system', role: (args.actor_role as 'admin' | 'author' | 'approver' | 'viewer') ?? 'admin' };
      }
    } else {
      actor = {
        id: typeof args.actor_id === 'string' ? args.actor_id : 'system',
        role: (args.actor_role as 'admin' | 'author' | 'approver' | 'viewer') ?? 'admin',
      };
    }
    return await runCrucibleWorkflow({
      artifact,
      contract,
      baseScorer,
      artifactId: `mcp-${Date.now()}`,
      knownStates: Array.isArray(args.known_states) ? args.known_states as string[] : [],
      actor,
    });
  },
};

/** 工具: judge 校准(Kendall τ) */
const calibrateJudgeTool: McpTool = {
  name: 'calibrate_judge',
  description: 'Run judge calibration against the golden set. Returns CalibrationReport with Kendall τ.',
  inputSchema: {
    type: 'object',
    properties: {
      contract_path: { type: 'string', description: 'Path to contract YAML file' },
    },
    required: ['contract_path'],
  },
  async handler(args) {
    const contract = loadContract(String(args.contract_path));
    const baseScorer = compileContract(contract);
    const report = await runJudgeCalibration(contract, baseScorer);
    saveCalibrationReport(report);
    return report;
  },
};

/** 工具: 契约演化(Contract-Author 修订) */
const evolveContractTool: McpTool = {
  name: 'evolve_contract',
  description: 'Generate contract revision patches from Curator novelty proposals. Returns ContractPatch[].',
  inputSchema: {
    type: 'object',
    properties: {
      contract_path: { type: 'string', description: 'Path to contract YAML file' },
      artifact_json: { type: 'string', description: 'JSON string of artifact to detect novelty from' },
      known_states: { type: 'array', items: { type: 'string' }, description: 'Known state tokens' },
    },
    required: ['contract_path', 'artifact_json'],
  },
  async handler(args) {
    const contract = loadContract(String(args.contract_path));
    const artifact = parseArtifact(String(args.artifact_json));
    const knownStates = Array.isArray(args.known_states) ? args.known_states as string[] : [];
    const proposals = await detectNovelty(artifact, knownStates);
    const patches = await contractAuthorRevise(contract, proposals);
    return { proposals, patches };
  },
};

/** 工具: champion-challenger A/B 对比 */
const abCompareTool: McpTool = {
  name: 'ab_compare',
  description: 'Compare champion vs challenger contracts on the golden set. Returns ABResult with τ delta + verdict.',
  inputSchema: {
    type: 'object',
    properties: {
      champion_path: { type: 'string', description: 'Path to champion contract YAML' },
      challenger_path: { type: 'string', description: 'Path to challenger contract YAML' },
    },
    required: ['champion_path', 'challenger_path'],
  },
  async handler(args) {
    const champion = loadContract(String(args.champion_path));
    const challenger = loadContract(String(args.challenger_path));
    const championScorer = compileContract(champion);
    const challengerScorer = compileContract(challenger);
    return await runABComparison(champion, challenger, championScorer, challengerScorer);
  },
};

/** 全部工具注册表 */
export const MCP_TOOLS: McpTool[] = [
  scoreArtifactTool,
  runWorkflowTool,
  calibrateJudgeTool,
  evolveContractTool,
  abCompareTool,
];

/** 按名称查找工具 */
export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find(t => t.name === name);
}
