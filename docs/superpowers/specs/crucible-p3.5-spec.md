# Crucible P3.5 Spec — 工程加固

> P3 已完成 (306 tests, 96/100, 契约自演化 + A/B + 校准 + 缓存 + 沙箱 + MCP + UI 完整闭环)。
> 本 spec 定义 P3.5 范围 (5 项),作为 P3.5 plan 的输入。
> **定位**: P3.5 是 P3 与 P4 之间的**工程加固层** — 关闭 P0 起悬而未决的两个架构决策、
> 补持久化基础、把基础算法升级到生产级。让 P4 (PRD v1.2 canonical ToB on-prem + audit trail
> + multi-tenant) 可以直接基于"加固过的引擎"启动,不再被技术债阻塞。
> 用户选定框架 D (工程加固)。

---

## 1. P3.5 Goal

把 **P0 起就悬而未决的两个架构决策** (Mastra v1.x / 真实 fork BigSet) 落地,给现有内存态加一层 **SQLite 持久化基础**,把基础新颖度检测和黄金集治理升级到生产级 — 让 P4 (ToB) 可以直接基于"加固过的引擎"启动,不再被技术债阻塞。

## 2. P3.5 范围 (5 项,按优先级)

### 2.1 架构决议落地 (Mastra + BigSet)

两个 P0 起就标 "TBD/P4" 的决策(原计划 P4 关闭,提前到 P3.5)必须在 P3.5 关闭,产出落地代码或 v3 决议文档 (二选一)。

#### 2.1.1 Mastra v1.x

- 调研 `@mastra/agents` / v2.x / 等可能补回 `Agent` 导出的包路径 (P3 评估时只查了 `@mastra/core`)
- 若可解决: 写 `src/agents/mastra-adapter.ts` (`SimpleAgent` → Mastra Agent wrapper),保持 `base.ts` 接口不变,启动 Mastra Server + Studio 可观测端点
- 若不可解决: 升级 `docs/decisions/mastra-p3-evaluation.md` 为 v2 决议 "**永久放弃 Mastra,SimpleAgent 转正**",删除 dev dep 残留,把 `base.ts` 注释里"未来迁移到 Mastra"字样移除
- 产出: 决议或适配层 + 测试

**依赖: 无 (独立调研,决定后续架构方向)**

#### 2.1.2 真实 fork BigSet

- 评估 fork 工程量 + upstream sync 负担 (OQ-21)
- 若 ≤ 2 天 + 不污染主仓: 在 `src/upstream/bigset/` 下落地真实 fork,把 `bigset-adapter.ts` 改成调用 fork 的内部 API,**对齐 PRD v1.2 "fork 进 Mastra 编排"叙事**
- 若否: 升级为 `docs/decisions/bigset-fork-evaluation.md` 正式决议 "**永久走 adapter 模式**" + 关闭 OQ-21
- 产出: fork 代码或决议文档

**依赖: 无 (两个独立决策)**

### 2.2 SQLite 持久化层

当前所有状态在 LRU 内存 + 文件,没有"历史"概念。P4 (ToB) 的审计轨迹依赖持久化基础 — P3.5 先把基础层搭好,不绑业务。

- 选型: `better-sqlite3` (同步 API,Node 友好) — Windows 编译若失败降级到 `sql.js` (纯 WASM)
- 数据模型 (`src/persistence/`):
  - `contracts` (version, yaml_text, parent_version, created_at, diff_summary)
  - `score_runs` (artifact_hash, contract_version, report_json, det_score, judge_score, created_at)
  - `ab_results` (champion_version, challenger_version, tau_champ, tau_chall, verdict, created_at)
  - `proposals` (artifact_hash, novelty_summary, dim, tokens, created_at, gate_decision)
- Schema 用 zod 校验 + 简单 SQL migration 脚本 (`src/persistence/migrations/`)
- LRU 缓存层**保留** (热路径) — 持久化只做 sink,不替换 cache 命中路径
- 测试: schema 迁移、并发写、artifact_hash 唯一性、retrieval 正确性

**依赖: 无**

### 2.3 新颖度检测算法 v2 (OQ-14)

当前 `src/agents/curator.ts` 只做 state/node_type 的 string-set diff。PRD v1.2 §6 三锚的"新颖度与分数分离"要求新颖度检测必须健壮 — 这是自演化飞轮的关键门。

- 新增 `src/curator/novelty_v2.ts`,保持 `detectNovelty()` 旧函数签名兼容
- 3 个检测器:
  - **Schema-diff**: 字段集变化 (artifact 出现 contract 未定义的 field) — 确定性
  - **Distribution outlier**: 数值字段 (cost / duration_min / source_trust) 的 z-score (基于黄金集统计) — 确定性
  - **(可选) Embedding distance**: `@xenova/transformers` 本地嵌入 (all-MiniLM-L6-v2 ~22MB) — 默认 OFF,env flag 开启
- 阈值标定: 用 P1 黄金集 8 工件 + P2 fixture 数据
- 测试: 各检测器独立 + 集成 + 假阳/假阴 case

**依赖: 无 (但 §2.2 持久化后可记录 novelty 历史)**

### 2.4 冻结黄金集治理 (OQ-16)

当前 `golden/hk_sequence_v1.jsonl` 是手工冻结,无规模/构造/防腐规则,长期会过时。

- 新增 `docs/governance/frozen-golden-set.md`:
  - **规模**: 当前 8 工件 → P3.5 扩到 20-30 (覆盖 3 区域 × 3 质量梯度 × 2 异常 case)
  - **构造规则**: 覆盖率矩阵 (artifact_family × node_type × violation pattern)
  - **重建周期**: 每 N 次契约演化或季度 review
  - **防腐协议**: 每次演化后跑 `audit-golden-set.ts`,检查 (a) 黄金集本身分数分布是否漂移 (b) 人类排序与 judge 排序 τ 是否下滑
- 实现 `scripts/audit-golden-set.ts` 自动化检查 + 报告
- 扩容黄金集到 20-30 工件 (可借用 P2 fixture + 新增 5-10 个异常 case)

**依赖: §2.3 (新颖度 v2 的 distribution outlier 用黄金集统计)**

### 2.5 Demo & dev experience 清理

P3 QA 列的小技术债 + checkpoint remaining work 第 3 项。

- demo-html / mcp-server 从 `CRUCIBLE_DEMO_HTML=1` env flag 改为正式 npm script:
  - `npm run demo:html` (生成五段式 HTML)
  - `npm run mcp:serve` (启动 MCP server)
- 删除未使用的 `@modelcontextprotocol/sdk` dep (P3 手写 JSON-RPC 替代)
- 更新 README 到 P3.5 状态 + 加 "如何跑 demo" 章节
- 路演 demo HTML 五段式样式优化 (checkpoint 第 3 项)

**依赖: 无**

## 3. P3.5 验收标准

### 3.1 架构决议落地

- Mastra: 适配层可用且通过测试,OR 决议文档 v2 完成 + 残留清理
- BigSet: fork 代码在 `src/upstream/` 且 adapter 切到内部调用,OR 决议文档 + OQ-21 关闭

### 3.2 SQLite 持久化层

- 4 个表 schema 完整 + migration 脚本
- 至少 15 个集成测试通过
- LRU 命中路径未受影响 (P3 cache 测试仍 14/14 pass)

### 3.3 新颖度 v2

- 3 个检测器各自单元测试通过
- 旧 `detectNovelty()` 接口向后兼容 (P0 curator 测试不破)
- 集成测试: 故意构造异常工件被正确识别

### 3.4 黄金集治理

- 治理文档存在
- audit 脚本可跑 + 输出报告
- 黄金集扩到 ≥ 20 工件,覆盖率矩阵满足

### 3.5 Demo & dev experience

- `npm run demo:html` / `npm run mcp:serve` 可用
- `@modelcontextprotocol/sdk` 从 deps 移除
- README 更新

### 3.6 整体健康

- 测试数 ≥ 350 (P3 是 306,P3.5 新增预计 50+)
- tsc clean
- 健康分数 ≥ 97 (P3 是 96)

## 4. P3.5 技术栈变更

- **新增**: `better-sqlite3` (生产 dep) — 若 Windows 编译失败降级到 `sql.js`
- **可选新增**: `@xenova/transformers` (新颖度 embedding,默认 OFF)
- **移除**: `@modelcontextprotocol/sdk` (未使用)
- **可能新增**: `@mastra/agents` 或 v2.x (视 §2.1.1 调研结果)

## 5. P3.5 不做 (留 P4)

- **ToB on-prem 定制交付** (PRD v1.2 canonical P4) → P4
- 审计轨迹导出 PDF → P4
- 多租户 / RBAC → P4
- 首个 vertical 定制契约 → P4
- DSL v1 社区评审 → 并行轨道,非阻塞
- Mastra Studio 集成 (除非 §2.1.1 走适配层路径)

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| `better-sqlite3` Windows 编译慢/失败 | 准备 `sql.js` 降级路径,在 §2.2 一开始就跑通编译验证 |
| 真 fork BigSet 引入大量上游代码污染 | 限制在 `src/upstream/bigset/` 子目录 + 严格只 copy 本产品依赖的子集;若超过 2 天直接转决议 |
| Mastra v2.x 仍未导出 Agent | 直接走决议路径,不勉强 |
| 新颖度 embedding 引入 50MB+ 模型 | 默认 OFF,env flag 开启,文档说明权衡 |
| 黄金集扩容时引入低质量样本反污染 | 扩容需经 audit 脚本 + 人审通过才合入 |

## 7. 执行结构 (4 Plans)

- **Plan 1**: §2.1 架构决议 (Mastra + BigSet 并行调研)
- **Plan 2**: §2.2 SQLite 持久化层
- **Plan 3**: §2.3 新颖度 v2 + §2.4 黄金集治理
- **Plan 4**: §2.5 demo/dev cleanup + P3.5 QA

## 8. 工作量预估

| 阶段 | Human-day | CC time |
|------|-----------|---------|
| Plan 1 | 1-1.5 | ~15 min |
| Plan 2 | 1.5-2 | ~20 min |
| Plan 3 | 1.5-2 | ~20 min |
| Plan 4 | 0.5-1 | ~10 min |
| **总计** | **4.5-6.5 天** | **~65 min** |
