/**
 * Crucible Live Env — 常量集中。
 * 所有魔法数在此,调阈值改这一个文件,diff 干净、review 容易。
 * spec ref: 2026-06-30-crucible-live-env-design.md §11.3
 */
export const ENV_CONST = {
  // LLM 录制(Plan 2 用;Plan 1 先定义占位)
  LLM_TEMPERATURE: 0.3,
  LLM_SEED: 42,
  LLM_SYSTEM_PROMPT_PATH: 'src/env/prompts/llm-source.system.md',

  // 配额(Plan 2 的 LLMEventSource 用)
  MAX_EVENTS_PER_SCENARIO: 8,
  MAX_CONSECUTIVE_FAILURES: 3,

  // 时间预算
  SCENARIO_TIMEOUT_MS: 90_000,
  WORKFLOW_WATCHDOG_MS: 90_000,

  // UI 通道(Plan 2 用)
  SSE_HEARTBEAT_MS: 15_000,
  SSE_RECONNECT_HINT_MS: 3_000,

  // 持久化
  EVENT_TABLE: 'env_events',
} as const;
