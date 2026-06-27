-- P3.5 §2.2 migration v1: 核心持久化 schema。
-- 4 张表: contracts / score_runs / ab_results / proposals。
-- 所有 CREATE TABLE IF NOT EXISTS —— migrate() 可重复执行(idempotent)。

-- 契约版本历史。每次契约演化(human gate 通过)写一行。
CREATE TABLE IF NOT EXISTS contracts (
  version INTEGER PRIMARY KEY,            -- 契约版本号(对应 contract metadata.version)
  family TEXT NOT NULL,                   -- artifact_family(如 'sequence' / 'table')
  yaml_text TEXT NOT NULL,                -- 完整 Contract YAML 文本
  parent_version INTEGER,                 -- 上一版本号(v1 为 NULL)
  diff_summary TEXT,                      -- 与父版本的 diff 摘要(人/LLM 生成)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (parent_version) REFERENCES contracts(version)
);

-- 打分运行记录。每次 score(artifact) 落一行(含 deterministic + judge)。
-- artifact_hash 唯一性: 同一 artifact + 同一 contract_version 只记最新一次。
CREATE TABLE IF NOT EXISTS score_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_hash TEXT NOT NULL,            -- hash(artifact 内容),确定性
  contract_version INTEGER NOT NULL,      -- 打分时用的契约版本
  report_json TEXT NOT NULL,              -- 完整 ScoreReport JSON
  det_score REAL NOT NULL,                -- deterministic_score(冗余存储便于查询)
  judge_score REAL,                       -- judge.overall_score(Part 1 阶段 NULL)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contract_version) REFERENCES contracts(version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_score_runs_artifact_contract
  ON score_runs(artifact_hash, contract_version);

-- A/B 比较结果。champion-challenger 每次比较写一行。
CREATE TABLE IF NOT EXISTS ab_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  champion_version INTEGER NOT NULL,
  challenger_version INTEGER NOT NULL,
  tau_champ REAL NOT NULL,                -- champion Kendall τ
  tau_chall REAL NOT NULL,                -- challenger Kendall τ
  verdict TEXT NOT NULL CHECK(verdict IN ('promote','retain')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (champion_version) REFERENCES contracts(version),
  FOREIGN KEY (challenger_version) REFERENCES contracts(version)
);

-- Curator 新颖度提议记录。每次 detectNovelty 落一行 + human gate 决策。
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_hash TEXT NOT NULL,
  contract_version INTEGER NOT NULL,      -- 检测时所用契约版本
  dim TEXT NOT NULL CHECK(dim IN ('state','node_type','schema','distribution','embedding')),
  tokens_json TEXT NOT NULL,              -- 新颖 token 数组 JSON
  rationale TEXT,
  gate_decision TEXT CHECK(gate_decision IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contract_version) REFERENCES contracts(version)
);
