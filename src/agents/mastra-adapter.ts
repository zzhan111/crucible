/**
 * Mastra Adapter (P3.5 §2.1.1).
 *
 * P3 evaluation concluded Mastra 0.1.x was blocked by a missing @prisma-app/client
 * peer dep. As of @mastra/core v1.47.0 the peer deps are zod-only and `Agent` is
 * exported from the `@mastra/core/agent` subpath — the blocker is gone.
 *
 * This module bridges the legacy `SimpleAgent` (a {name, instructions} doc container,
 * P0 degraded impl) to a real Mastra `Agent` instance, WITHOUT changing the
 * `SimpleAgent` contract every consumer (contract-author, judge, scorer) already
 * depends on.
 *
 * Design:
 * - `createMastraAgent()` returns a `SimpleAgent`-compatible facade.
 * - The facade carries `name` + `instructions` (backward compat) plus a lazy
 *   `getMastraAgent(model?)` accessor that instantiates the real Mastra Agent
 *   on demand. Mastra Agent requires a `model` at construction time, but
 *   Crucible agents are built registry-side without a model (the LLM client is
 *   created at call sites). Lazy construction keeps registry code unchanged.
 * - The Mastra runtime path is gated on `CRUCIBLE_USE_MASTRA=1` so the default
 *   behavior (no Mastra orchestration, just like P3) is unchanged and tests
 *   stay deterministic. When the env flag is set, callers that opt into
 *   `getMastraAgent(model)` get orchestration/memory/streaming for free.
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.1.1
 */
import { Agent } from '@mastra/core/agent';
import type { SimpleAgent } from './base.js';

/**
 * A SimpleAgent that MAY also expose a real Mastra Agent instance.
 *
 * `getMastraAgent` is optional so existing code that only reads name/instructions
 * keeps type-checking against the base `SimpleAgent` interface.
 */
export interface MastraBackedAgent extends SimpleAgent {
  /** Lazily build (and memoize) a real Mastra Agent bound to `model`. */
  getMastraAgent?: (model: unknown) => Agent;
}

// Memoize per (name + instructions) string key so repeated createMastraAgent
// calls for the same agent config return the SAME Mastra Agent instance —
// long-lived registries don't leak duplicate instances. A Map<string, Agent>
// (not WeakMap) because the key is a primitive string, not an object identity.
const instanceCache = new Map<string, Agent>();

/**
 * Wrap a {name, instructions} pair as a Mastra-backed agent facade.
 *
 * Returns a `MastraBackedAgent` — structurally a `SimpleAgent`, so it slots
 * into every existing consumer. When a caller wants orchestration/memory it
 * calls `agent.getMastraAgent(model)` with a Mastra-compatible model client
 * (e.g. from @ai-sdk/openai) to obtain the real `Agent`.
 */
export function createMastraAgent(name: string, instructions: string): MastraBackedAgent {
  const facade: MastraBackedAgent = { name, instructions };

  // Only attach the Mastra accessor when explicitly opted in. Default path
  // stays identical to P3's createSimpleAgent — no Mastra import side effects
  // touch the registry unless the user asks for it.
  if (process.env.CRUCIBLE_USE_MASTRA === '1') {
    facade.getMastraAgent = (model: unknown): Agent => {
      const key = `${name}\u0000${instructions}`;
      let inst = instanceCache.get(key);
      if (!inst) {
        // Mastra Agent shape: { id, name, instructions, model }. `id` is a
        // stable string identifier (required by AgentConfig). `model` is any
        // LanguageModelV1-compatible client (the ai SDK contract).
        inst = new Agent({ id: name, name, instructions, model: model as never });
        instanceCache.set(key, inst);
      }
      return inst;
    };
  }

  return facade;
}

/**
 * Whether the Mastra runtime path is active for this process.
 * Exposed for tests and observability — lets callers branch without re-reading env.
 */
export function isMastraRuntimeActive(): boolean {
  return process.env.CRUCIBLE_USE_MASTRA === '1';
}
