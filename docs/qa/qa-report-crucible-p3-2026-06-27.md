# P3 QA Report — Crucible

> Date: 2026-06-27
> Branch: crucible/dev
> P3 scope: Mastra评估 + 缓存层 + BigSet生产级 + DSL草案 (§2.1-2.4)
> Tier: Standard (critical + high + medium)

---

## 摘要

| 指标 | 值 |
|------|-----|
| 测试总数 | 306 |
| 测试通过 | 306 (100%) |
| 测试文件 | 39 |
| tsc 类型检查 | clean |
| P3 新增测试 | 53 (cache 14 + production 19 + p3-acceptance 20) |
| QA 发现问题 | 1 (修复过程中发现) |
| 已修复 | 1 (verified) |
| 健康分数 | **96/100** |

## 健康分数明细

| 类别 | 权重 | 得分 | 说明 |
|------|------|------|------|
| 测试覆盖 | 25% | 100 | 306/306 pass, P3 3 模块全覆盖 |
| 类型安全 | 20% | 100 | tsc --noEmit clean |
| 错误处理 | 20% | 95 | retry/rate-limit/clean 完整, retry actualAttempts 已修复 |
| 功能正确 | 20% | 95 | Mastra 评估完成, 缓存集成 augmented.ts |
| 代码卫生 | 15% | 90 | P2 修复后保持(demo-report.html 已 untrack), 新模块结构清晰 |

**总分: 96/100** (P0: 92 → P1: 94 → P2: 95 → P3: 96)

## P3 验收标准核对 (§3.1-3.4)

### §3.1 Mastra 评估完成 ✅
- 评估报告: `docs/decisions/mastra-p3-evaluation.md`
- 版本对比: P0 时 0.1.26(peer dep 缺失) → 当前 1.47.0(peer dep 已修复)
- 决议: **保持 SimpleAgent**(v1.x 破坏性 API 变更, 升级成本 > 收益)
- 未来路径: P4+ 再评估(若需 Mastra Studio 可观测性)

### §3.2 缓存层可用 ✅
- LRU 缓存(`src/cache/scorer-cache.ts`): 200 条容量, 10 分钟 TTL
- Judge 缓存(`src/cache/judge-cache.ts`): 50 条, 5 分钟 TTL
- 集成 `scorer/augmented.ts`: 同工件+同契约版本第二次打分命中
- key = sha256(JSON.stringify(artifact) + contract.metadata.version)
- 14 cache 测试: LRU 淘汰 / TTL 过期 / 访问更新顺序 / key hash / 全局单例

### §3.3 BigSet 采集器生产级 ✅
- **Retry**(`retry.ts`): 指数退避(默认 3 次, x2 backoff, max 5000ms)
- **Rate Limit**(`rate-limit.ts`): 令牌桶(默认 10 容量/秒 5 令牌)
- **Concurrency**(同上): 并发限制器(默认 3)
- **Cleaner**(`cleaner.ts`): 去重/标准化/空节点移除
- **Production Collector**: 集成全部 + 自动 dedupe by competitor_name
- 19 production 测试: 重试/退避/速率/并发/清洗/集成

### §3.4 DSL 开放标准草案 ✅
- 文档: `docs/dsl-standard/crucible-dsl-v1.md` (草案 v0.1)
- 8 章节完整:
  - §1 概述(设计目标 + 核心概念 + 与传统 DSL 区别)
  - §2 Schema 规范(顶层 + FieldDef + HardConstraint + RubricEntry + Calibration)
  - §3 约束类型(declarative + code_predicate + 沙箱安全要求 + Violation 结构)
  - §4 Rubric 模式(deterministic + judge + proxy+judge + 缺失数据约定)
  - §5 版本治理(version + ContractPatch + 应用规则 + 兼容性)
  - §6 跨族兼容(artifact_family + 适配器模式 + P1 探针验证)
  - §7 校准(黄金集 + 人类排序 + Kendall τ + P1 实测结果)
  - §8 开放性(互换性原则 + 参考实现 + 实现指南 + 标准化路径)
- 附录: 完整 Contract 示例

## QA 发现的问题

### ISSUE-002: retry.ts `attempts` 字段错误 [已修复]
- **严重度**: medium
- **类别**: 错误处理
- **描述**: `withRetry` 在 `shouldRetry=false` 触发 break 后,返回 `attempts: maxAttempts` 而非实际尝试次数。导致调用方误以为重试到了上限,统计不准。
- **复现**: 测试 "shouldRetry=false 时停止重试" 期望 attempts=1, 实际返回 5
- **修复**: 引入 `actualAttempts` 变量在循环内更新,返回实际值
- **提交**: 76dd1c7(与 Plan 2 同提交)
- **验证**: 19 production 测试全部通过

## 未发现问题(验证通过的点)

1. **Mastra 升级风险**: 调研发现 v1.x 破坏性变更, 决议正确(避免重写 7 个 agent 文件)
2. **缓存键稳定性**: sha256(artifact + version), 同输入相同, 不同版本不同
3. **缓存 TTL 正确**: 50ms TTL 测试 60ms 后失效
4. **LRU 访问更新**: get 后元素移到末尾, 不被淘汰
5. **Retry 指数退避**: 10ms → 20ms → 40ms (验证)
6. **Rate Limit 令牌桶**: 容量限制 + refill 正确
7. **Concurrency 并发限制**: 峰值不超 maxConcurrent
8. **Cleaner 去重**: dedupeKey + JSON 整体两种模式
9. **Production Collector 集成**: collectOne/collectMany + stats 完整
10. **DSL 草案完整性**: 8 章节 + Schema 与 ContractSchema 一致

## P3 累计提交

```
6efda98 P3 Plan 1: Mastra评估 + 缓存层 (§2.1-2.2)
76dd1c7 P3 Plan 2: BigSet 采集器生产级 (§2.3)
```

## 结论

P3 4 项全部通过验收(§3.1-3.4),健康分数 96/100。1 个 medium 问题(retry attempts)已在开发中发现并修复。

**STATUS: DONE**
