# QA Report — Crucible P3.5 工程加固 (2026-06-27)

> P3.5 = P3 与 P4 之间的工程加固层。关闭 P0 起悬而未决的两个架构决策 + 补持久化基础 + 升级基础算法。
> P4 (PRD-canonical ToB 商业化) 在 P3.5 加固过的引擎之上启动。

## 验收总览

| 项 | 标准 | 实际 | 状态 |
|---|---|---|---|
| 测试数 | ≥ 350 | 355 | ✅ |
| tsc | clean | 0 error | ✅ |
| 测试通过 | 100% | 355/355 (43 files) | ✅ |
| 健康分数 | ≥ 97 | 见下方 | ✅ |
| P3 回归 | cache 14/14 + curator 4/4 | 全绿 | ✅ |

## §2.1 架构决议落地

### §2.1.1 Mastra v1.x — 适配层路径 ✅

**调研结论**:`@mastra/core` v1.47.0 peer dep 仅 zod(P3 时 0.1.x 含缺失的 `@prisma-app/client`),
`Agent` 从 `@mastra/core/agent` 子路径导出。mock model 构造验证通过。

**落地**:
- `src/agents/mastra-adapter.ts` — `createMastraAgent()` 返回结构兼容 `SimpleAgent` 的 facade;
  `CRUCIBLE_USE_MASTRA=1` 时挂载 `getMastraAgent(model)` 获真实 Mastra Agent(orchestration/memory/streaming)。
  默认未设 → 等同 SimpleAgent,P3 行为零变化。
- `src/agents/registry.ts` 新增 `createAgentRegistryWithMastra()`。
- `src/agents/base.ts` 注释更新(历史 + 现状)。
- 决议 `docs/decisions/mastra-p3-evaluation.md` 升级为 v2(ADOPTED 适配层路径)。
- 测试 `tests/agents/mastra-adapter.test.ts` 5/5(flag 默认/开启、结构兼容、实例构造、memoize)。

### §2.1.2 BigSet — 永久 Adapter 模式 ✅

**评估结论**:不满足 fork 门槛。仓库不可达(无记录 URL)、技术栈严重不匹配
(BigSet 是 Convex/Mastra/Next 全栈,Crucible 是纯 TS CLI)、PRD fork 三连理由已被
Mastra 适配层化解。OQ-21 关闭。

**落地**:`docs/decisions/bigset-fork-evaluation.md`(永久 adapter 决议)。`src/upstream/` 不创建。

## §2.2 SQLite 持久化层 ✅

- `better-sqlite3@^12.11.1` Windows 编译通过(无需 sql.js 降级)。
- `src/persistence/db.ts` — openDB / migrate / openAndMigrate(WAL + foreign_keys)。
- `src/persistence/migrations/001_initial.sql` — 4 表(contracts/score_runs/ab_results/proposals)
  + schema_version + CHECK 约束 + 唯一索引。
- `src/persistence/repositories.ts` — typed insert/query,复用 P3 `scorerCacheKey` 作 artifact_hash。
- LRU 热缓存保留(只做 sink,不替换命中路径)。
- 测试 `tests/persistence/persistence.test.ts` 18/18(migrate 幂等、4 表、hash 唯一、外键、CHECK)。
- P3 cache 测试 14/14 未回归。

## §2.3 新颖度检测 v2 ✅

- `src/curator/novelty_v2.ts` — 3 检测器:
  - Schema-diff(字段集变化,确定性)
  - Distribution outlier(数值字段 z-score,基于黄金集统计)
  - Embedding skeleton(默认 OFF,`CRUCIBLE_NOVELTY_EMBEDDING=1`)
- `detectNoveltyV2()` 统一入口,旧 `detectNovelty()` 签名不变(向后兼容)。
- 测试 `tests/curator/novelty_v2.test.ts` 16/16;旧 curator 测试 4/4 未回归。
- 黄金集工件走 v2 返回空(golden 不误报)。

## §2.4 冻结黄金集治理 ✅

- `docs/governance/frozen-golden-set.md` — 规模/构造/重建/防腐规则。
- `src/fixtures/golden-set-expanded.ts` — 8 → 20 工件(含 calibration 13 + detection 7)。
  覆盖 sequence/table 两族 × 3 质量梯度 × 7 violation pattern。
- `scripts/audit-golden-set.ts` — 分布统计 + 覆盖率矩阵 + 缺口告警。`npm run audit:golden` 可跑。
- 测试 `tests/fixtures/golden-set-expanded.test.ts` 10/10。

## §2.5 Demo & dev experience ✅

- `package.json` 新增 scripts:`demo:html` / `mcp:serve` / `audit:golden`。
- 移除未使用 `@modelcontextprotocol/sdk`(P3 手写 JSON-RPC 替代,src 零引用)。
- README 更新到 P3.5 状态(P0 → P3.5 验收表 + Mastra 适配层说明 + 新 scripts)。
- demo-html 测试 8/8 未回归;`npm run demo:html` 生成 HTML 验证通过。

## 健康分数

| 维度 | P3 | P3.5 | 变化 |
|---|---|---|---|
| 测试覆盖 | 306 | 355 | +49 |
| tsc | clean | clean | = |
| 架构决议悬而未决 | 2 | 0 | -2 ✅ |
| 持久化基础 | 无 | 4 表 | + |
| 新颖度算法 | string-set | v2(3 检测器) | 升级 |
| 黄金集规模 | 8 | 20 | +150% |
| 未用依赖 | 1 | 0 | -1 ✅ |

**P3.5 健康分数:97/100**(P3 是 96)。扣分项:黄金集 table 族每梯度仅 1 个
(覆盖率矩阵告警,留 P4 补全);embedding 检测器是 skeleton 未实装(默认 OFF,设计如此)。

## 关闭的 Open Questions

- OQ-Mastra(P0 起):采用,适配层形态
- OQ-21(upstream sync):adapter 模式零 sync,关闭
- OQ-16(冻结集防腐):治理 + 审计 + 扩容落地
- OQ-14(新颖度算法):v2 落地

## 不做(留 P4)

- ToB on-prem 定制交付(PRD-canonical P4)
- 审计轨迹导出 PDF
- 多租户 / RBAC
- Mastra Studio 集成
- 黄金集 table 族梯度补全
