-- Live Env v1 migration v4: env_events 表。
-- spec ref: 2026-06-30-crucible-live-env-design.md §7.2
--
-- 记录每个 env 事件 + 是否被 consume 折叠进 artifact。
-- 两次写入策略:publish 时落 row(applied=0),consume 后回填 applied=1 + applied_iter。
-- run_id 关联 score_runs(不加 FK 约束,沿用项目惯例降低迁移阻力)。

CREATE TABLE IF NOT EXISTS env_events (
  id           TEXT PRIMARY KEY,            -- LiveEnvEvent.id (uuid)
  run_id       TEXT NOT NULL,               -- 同一次 startLiveEnv 共享
  scenario     TEXT NOT NULL,               -- 'travel-drift' | 'intel-drift'
  kind         TEXT NOT NULL CHECK(kind IN ('disruption','info_drop','constraint_update')),
  emitted_by   TEXT NOT NULL CHECK(emitted_by IN ('llm','replay','fixture')),
  t_offset_ms  INTEGER NOT NULL,
  payload_json TEXT NOT NULL,               -- 整段 payload(不拆列,SQLite json_extract 查询)
  applied      INTEGER NOT NULL DEFAULT 0,  -- 0/1,是否被 consume 折叠
  applied_iter INTEGER,                     -- 被哪一轮 iteration consume(NULL = 未消费)
  actor_id     TEXT,                        -- 触发本次 demo 的 actor(沿用 RBAC SYSTEM_ACTOR)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_env_events_run_id   ON env_events(run_id);
CREATE INDEX IF NOT EXISTS idx_env_events_scenario ON env_events(scenario, created_at);
