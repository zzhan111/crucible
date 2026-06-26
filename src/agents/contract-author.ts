import { createSimpleAgent, type SimpleAgent } from './base.js';
import type { Contract } from '../contract/schema.js';
import type { ContractPatch } from '../contract/patch.js';
import type { ExpansionProposal } from './curator.js';
import type { Artifact } from '../predicates/types.js';
import { callLLM, hasApiKey } from '../llm/client.js';

// P0:Contract-Author 只读现有契约,不自动改
// P1 §2.5:Contract-Author 升级为 LLM 修订(generate ContractPatch diff)
// 降级实现(spec §7):用 SimpleAgent 替代 Mastra Agent,P2 升级时替换
export function createContractAuthorAgent(): SimpleAgent {
  return createSimpleAgent(
    'contract-author',
    `You are the Contract-Author agent. In P1, you read the current Contract YAML + Curator novelty proposals, then generate a revision diff (ContractPatch). You do not auto-apply; output goes to Human Gate for approval.`
  );
}

export function contractAuthorRead(contract: Contract): Contract {
  console.log('[Contract-Author] reading contract (P0: no modification)');
  return contract;
}

/**
 * contractAuthorRevise (P1 §2.5): 读现有 Contract + Curator 新颖度提议,
 * 用 LLM 生成修订 diff(ContractPatch)。
 *
 * 流程:
 * 1. 把 Contract YAML + proposals 拼成 prompt
 * 2. LLM 输出 JSON 格式的 patches
 * 3. 解析为 ContractPatch[](格式校验)
 *
 * 降级(无 API key):返回空 diff(不修订)。
 *
 * @returns ContractPatch[] 修订提案(不自动应用)
 */
export async function contractAuthorRevise(
  contract: Contract,
  proposals: ExpansionProposal[]
): Promise<ContractPatch[]> {
  console.log(`[Contract-Author] revising contract with ${proposals.length} proposals`);

  if (proposals.length === 0) {
    console.log('[Contract-Author] no proposals, returning empty diff');
    return [];
  }

  if (!hasApiKey()) {
    console.log('[Contract-Author] no API key, degraded mode: returning empty diff');
    return [];
  }

  // 拼 prompt:现有 Contract 概要 + 新颖度提议
  const contractSummary = {
    artifact_family: contract.artifact_family,
    fields: contract.fields.map(f => f.name),
    hard_constraints: contract.hard_constraints.map(c => ({ id: c.id, type: c.type })),
    rubric: contract.rubric.map(r => ({ dim: r.dim, weight: r.weight, mode: r.mode })),
  };

  const proposalsSummary = proposals.map(p => ({
    dim: p.dim,
    tokens: p.tokens,
    rationale: p.rationale,
    proposed_constraint: p.proposed_constraint,
  }));

  const prompt = `You are the Contract-Author agent for a travel itinerary synthesis engine.
You receive the current Contract (executable YAML schema) and Curator novelty proposals (new state tokens / node types observed in artifacts).

Your task: generate a minimal revision diff (ContractPatch array) to expand the Contract.

Current Contract summary:
${JSON.stringify(contractSummary, null, 2)}

Curator novelty proposals:
${JSON.stringify(proposalsSummary, null, 2)}

Generate a JSON array of ContractPatch objects. Each patch must be one of:
- {"op":"add_field","field":{"name":"...","type":"string|integer|number|enum|string[]","required":true,"values":["..."]},"reason":"..."}
- {"op":"add_constraint","constraint":{"id":"...","type":"declarative","rule":"...","mutex":["token_a","token_b"]},"reason":"..."}
- {"op":"adjust_weight","dim":"...","new_weight":0.0,"reason":"..."}
- {"op":"add_rubric","rubric":{"dim":"...","weight":0.0,"mode":"deterministic|judge|proxy+judge"},"reason":"..."}

Rules:
- Only add what the novelty proposals justify (e.g., new mutex pairs for novel state tokens)
- Do NOT remove existing fields/constraints unless clearly broken
- If adjusting weights, ensure they still sum to 1.0 after all adjustments
- Respond with ONLY the JSON array, no markdown fences

If no revision is needed, respond with []`;

  const raw = await callLLM(prompt);
  if (!raw) {
    console.log('[Contract-Author] LLM returned null, returning empty diff');
    return [];
  }

  // 解析 LLM 输出为 ContractPatch[]
  try {
    // 提取 JSON(可能被 markdown 包裹)
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) {
      console.log('[Contract-Author] LLM output not an array, returning empty diff');
      return [];
    }
    console.log(`[Contract-Author] generated ${parsed.length} patches`);
    return parsed as ContractPatch[];
  } catch (e) {
    console.log(`[Contract-Author] failed to parse LLM output: ${(e as Error).message}`);
    return [];
  }
}
