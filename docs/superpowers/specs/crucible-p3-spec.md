# Crucible P3 Spec — Mastra评估 + 缓存层 + BigSet生产级 + DSL草案

> P2 已完成(253 tests, 95/100, 沙箱+采集+MCP+UI)。
> 本 spec 定义 P3 范围(4 项),作为 P3 plan 的输入。
> P2 §5 延期项中,用户选定 4 项纳入 P3,数据库+微优化留 P3+,多租户留 P4。

---

## 1. P3 Goal

把 P2(可外部接入+可采集+可路演)升级为**高性能+架构定型+标准化**:
- Mastra 架构定调(升级或决议保持)
- 性能优化(缓存层减少重复计算/LLM调用)
- 采集器生产级(重试/并发/速率限制/清洗)
- DSL 开放标准草案(总结 P0-P3 设计为可互换规范)

## 2. P3 范围(4 项,按优先级)

### 2.1 Mastra 升级评估(架构定调)

- 调研 @mastra/core 最新版(npm view versions/peerDeps)
- 尝试安装 + import 验证 peer dep 是否修复(@prisma-app/client 问题)
- 若可用: 升级 base.ts SimpleAgent → Mastra Agent,恢复 Studio 可观测
- 若不可用: 记录决议(版本/失败原因/替代方案),保持 SimpleAgent
- 产出: `docs/decisions/mastra-p3-evaluation.md`

**依赖: 无(独立调研,决定后续架构方向)**

### 2.2 缓存层 / 分级延迟

- 新增 `src/cache/` 模块:
  - `scorer-cache.ts`: LRU 缓存,key=hash(artifact+contract_version),value=ScoreReport
  - `judge-cache.ts`: judge 结果缓存(短期 TTL 5分钟),减少重复 LLM 调用
- 集成到 `scorer/augmented.ts`: 打分前查缓存
- 集成到 `workflow/crucible.ts`: pre-patch 确定性打分用缓存
- 测试: 缓存命中/未命中/TTL 过期/LRU 淘汰

**依赖: 无(独立性能优化)**

### 2.3 BigSet 采集器生产级

- 升级 P2 `src/collection/collector.ts`:
  - 错误重试(指数退避,最多 3 次)
  - 并发采集(Promise.all + 并发限制)
  - 速率限制(令牌桶,每秒 N 个请求)
  - 数据清洗(去重/字段标准化/空值处理)
- 新增 `retry.ts` + `rate-limit.ts`
- 用 P2 fixture 数据验证(不依赖真实 BigSet 仓库)

**依赖: 2.2(缓存层可被采集器复用)**

### 2.4 DSL 开放标准草案

- 新增 `docs/dsl-standard/crucible-dsl-v1.md`:
  - §1 概述(DSL 目标: 契约驱动合成,多 agent 协调基质)
  - §2 Schema 规范(fields/hard_constraints/rubric/calibration)
  - §3 约束类型(declarative rule/mutex + code_predicate 沙箱)
  - §4 Rubric 模式(deterministic/judge/proxy+judge)
  - §5 版本治理(Contract 版本号 + ContractPatch + compat)
  - §6 跨族兼容(artifact_family + 适配器模式)
  - §7 校准(黄金集 + Kendall τ + 人类排序)
  - §8 开放性(遵循 schema 即可互换)

**依赖: 2.1-2.3(总结所有阶段的 DSL 设计)**

## 3. P3 验收标准

### 3.1 Mastra 评估完成
- 评估报告存在(版本/peer dep/决议)
- 决议明确: 升级(Studio 可观测) 或 保持(SimpleAgent + 原因)

### 3.2 缓存层可用
- Scorer 缓存: 同工件+同契约第二次打分命中缓存(不重算)
- Judge 缓存: TTL 内重复调用命中(不重复 LLM)
- LRU 淘汰: 超容量时淘汰最旧

### 3.3 BigSet 采集器生产级
- 重试: 失败请求自动重试(指数退避)
- 并发: 并发限制生效(不超过 N 个)
- 速率: 令牌桶限制生效
- 清洗: 去重/标准化/空值处理正确

### 3.4 DSL 草案完成
- 文档含 8 章
- Schema 描述与 ContractSchema(zod)一致
- 版本治理/跨族/校准章节完整

## 4. P3 技术栈变更

- 可能新增: `@mastra/core`(若评估通过)
- 保持: `ai`@6.x, `yaml`, `zod`, `vitest`, `tsx`, `isolated-vm`

## 5. P3 不做(留 P3+/P4)

- 数据库(P3+)
- no_duplicate_state Set 微优化(P0-plan,ROI 低)
- 多租户 / ToB on-prem(P4)
- AGPL 商业化评估(P4)

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| Mastra peer dep 仍未修复 | 记录决议保持 SimpleAgent,P4 再试 |
| 缓存键设计不当导致误命中 | key=hash(JSON.stringify(artifact)+contract 版本) |
| BigSet 生产级无真实数据验证 | 用 P2 fixture + mock 网络层验证逻辑 |
| DSL 草案纯文档无代码验证 | 用 schema 测试交叉验证文档描述 |

## 7. 执行结构(3 Plan)

- Plan 1: Mastra 评估(2.1) + 缓存层(2.2)
- Plan 2: BigSet 生产级(2.3)
- Plan 3: DSL 草案(2.4) + P3 QA
