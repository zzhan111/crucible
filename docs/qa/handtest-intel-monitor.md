# P4.6 市场情报/竞品监测 vertical 人工 QA 清单

> intel-table-v1.1 深化:6 个硬约束(3 旧 + 3 新)+ 5 维 rubric(4 确定性 + 1 judge mock fallback)+ 公开竞品快照 + 端到端 monitor 演示。
> 每条给出**命令**与**预期结果**,可逐条判 pass/fail。
> Worktree:`D:\Apps\traveller.crucible-dev` · 分支 `crucible/p4.6-intel-deepen`

## 前置

- 依赖已装(`npm install`)。
- **降级模式即可**(无 `OPENAI_API_KEY`)。6 个硬约束 + 4 个确定性 rubric 全不依赖 LLM;
  judge 维度 `strategic_insight` 降级为 mock fallback(基于结构特征给 [0.4, 0.85] 区间分,非固定 0.5),设计内、非故障。
- 数据边界:本清单所有数据为**合成 fixture 或脱敏公开样例**,非真实企业竞品情报。

---

## A. 竞品监测 demo(核心,必跑)

**命令**
```bash
cd /d/Apps/traveller.crucible-dev
npm run intel:monitor
```

**预期**:打印 4 份情报表的 5 维评分报告 + 总分排名 + 监测说明。

| 工件 | 硬违规 | 软违规 | 命中 constraint_id | final_score |
|---|---|---|---|---|
| 合成-buggy | 3 | 1 | `no_empty_source` / `pricing_format` / `no_duplicate_competitor`(+ soft `source_trust_floor`) | 最低 |
| 合成-golden | 0 | 0 | — | 中高 |
| 公开-SaaS | 0 | 0 | — | 最高 |
| 公开-OSS | 0 | 0 | — | 中高 |

**Pass 判据**:
1. buggy 触发 3 硬违规 + 1 软违规(source_trust_floor 对 0.3 触发 soft)。
2. golden / 公开-SaaS / 公开-OSS 零违规,打印 `✓ 无违规(干净情报)`。
3. 排名:公开-SaaS > 公开-OSS ≈ golden > buggy(final_score 降序)。
4. strategic_insight 行打印 `[judge]` + rationale 含 `mock fallback`(无 key 时)或真实 LLM 输出(有 key 时)。
5. 末尾"监测说明"列出 hard/soft 违规语义 + 5 维 rubric 名称。

**Fail 信号**:硬违规串扰、干净情报误报、judge 报错未降级(进程崩溃)。

---

## B. 3 个新硬约束谓词逐项验证

逐个谓词单独触发,确认边界正确。命令见自动测试(§H)或 `npx vitest run tests/predicates/`。

| 谓词 | 触发条件 | 严重度 | 验证档案(黄金集) | 预期 message 含 |
|---|---|---|---|---|
| `stale_pricing` | last_verified 超 180 天 | hard | `vio-stale-pricing`(2025-09/08) | `陈旧` + `天数` |
| `source_trust_floor` | < 0.2 硬 / < 0.4 软 | hard/soft | `vio-trust-floor`(0.1/0.15) | `0.1` + `0.2` |
| `unit_consistency` | pricing 无可归一化单位 | soft | (自动测试覆盖) | `单位不可归一化` |

**Pass 判据**:
1. `vio-stale-pricing` 触发 `stale_pricing` hard,且全部 2 行均报。
2. `vio-trust-floor` 触发 `source_trust_floor` hard(0.1/0.15 均 < 0.2)。
3. 边界:恰好 180 天不触发 stale_pricing(> 才触发);0.2 不触发硬地板(< 才触发);0.4 不触发软地板。
4. 3 个公开快照 calibration(intel-pub-saas/oss/oss-low)均无硬违规。

**Fail 信号**:边界 off-by-one、severity 错配(soft 误报 hard)。

---

## C. 不同iator_density + strategic_insight judge

**命令**
```bash
npx vitest run tests/rubric/differentiator_density.test.ts tests/rubric/strategic_insight.test.ts
```

| rubric | 类型 | 度量 | mock fallback 行为 |
|---|---|---|---|
| `differentiator_density` | 确定性 | feature 非空且 ≥ 8 字符的行占比 | —(纯确定性) |
| `strategic_insight` | judge | 差异点实质性 / 可比性 / 决策支撑 | 无 key 时:0.4 + 0.1*(竞品数-1) + 0.1*coverage,clamp [0.4, 0.85] |

**Pass 判据**:
1. differentiator_density:全具体 feature → 1.0;空泛 feature 按占比给分;空表 → 0。
2. strategic_insight:有 key 走 LLM(分值 0-1);无 key 走 mock,rationale 含 `mock fallback` + `N competitors`。
3. mock 分值随竞品数增加(2 竞品 < 4 竞品),体现"诚实降级"非固定 0.5。

**Fail 信号**:mock 固定 0.5(未体现结构差异)、judge 抛异常未降级。

---

## D. 边界与降级(必读,非命令)

- **stale_pricing 阈值**:默认 180 天,可由 `makeStalePricing(maxAgeDays)` 自定义。参考日期固定 2026-06-25(与 freshness.ts 一致),避免时间依赖。
- **source_trust_floor 双门槛**:< 0.2 硬(来源几乎不可信,不入决策)/ < 0.4 软(偏弱,待复核)。
- **unit_consistency 与 pricing_format 关系**:pricing_format(hard)先保证有数字或"免费";unit_consistency(soft)在此基础上检查单位可归一化。缺 pricing / "未知/n/a" 由 pricing_format 拦截,unit_consistency 跳过不重复报。
- **strategic_insight 不进 deterministic.rubric_scores**:它是 judge 维度,只在使用 `createJudgeAugmentedScorer`(async)时才跑,基础 `compileContract` 的同步 score 不含它。demo 脚本用 augmented scorer 体现完整 5 维。

---

## E. 跨功能:审计轨迹导出(intel 工件落库 + 导出)

**命令**(回归现有 P4.1 功能,不写新代码)
```bash
cd /d/Apps/traveller.crucible-dev
# 先确保有 DB(运行过任何 persistScoreRun 的测试或 demo)
npx tsx scripts/audit-trail-export.ts --artifact <intel-artifact-id> --format md
```

**预期**:能对 intel 族(table)工件生成审计导出(出处 + 分数 + 违规 + rubric)。

**Pass 判据**:
1. 导出不报错,生成 markdown 含 artifact 概要 + score_runs 历史 + rubric 分数。
2. intel 工件的 family=table 正确识别。
3. 若该 artifact 无落库记录,导出空轨迹(不崩溃)。

**Fail 信号**:family 不匹配、SQL 报错、PDF 导出 CJK 乱码(走 `--format pdf` 验证字体)。

---

## F. 黄金集覆盖(自动 + 手测)

**命令**
```bash
npx vitest run tests/fixtures/golden-set-expanded.test.ts
```

**预期**:24 测试全绿。

| 类别 | 数量 | id |
|---|---|---|
| intel calibration(新增 P4.6) | 3 | intel-pub-saas / intel-pub-oss / intel-pub-oss-low |
| intel detection(新增 P4.6) | 2 | vio-stale-pricing / vio-trust-floor |
| 总 EXPANDED_GOLDEN | 37 | (原 32 + 5) |
| 总 CALIBRATION_GOLDEN | 25 | (原 22 + 3) |

**Pass 判据**:
1. 3 个公开快照 calibration 在 v1.1 契约下零硬违规。
2. vio-stale-pricing 触发 stale_pricing hard;vio-trust-floor 触发 source_trust_floor hard。
3. 公开快照竞品名与既有 intel 不重复(无 duplicate_competitor 串扰)。
4. table 族每个 tier ≥ 2 calibration(审计 cell 不告警)。

---

## G. 沙箱降级安全网(intel 谓词不进沙箱,验证不崩)

intel-table-v1.1 的 6 个硬约束全部是**内置 declarative 谓词**(走 compiler switch),不进 isolated-vm 沙箱。
故无沙箱降级路径——这与 financial-v1(code_predicate 进沙箱)不同,是设计选择:

- intel 谓词逻辑简单(字段检查 + 日期比较),无需沙箱隔离。
- financial 谓词计算比率/聚合,用 code_predicate 动态 impl 更灵活。

**验证**:运行 A 段 demo,无 `[Sandbox:vm] execution failed` 警告即可(本就不该出现)。

---

## H. 自动测试覆盖(无需手测)

```bash
npx vitest run
```

**预期**:485 测试全绿(原 457 + 28 新增/扩展)。

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| tests/predicates/stale_pricing.test.ts | 5 | 阈值 / 边界 / 自定义 / 缺字段 |
| tests/predicates/source_trust_floor.test.ts | 4 | 硬地板 / 软地板 / 缺字段 / 干净 |
| tests/predicates/unit_consistency.test.ts | 5 | 规范单位 / 裸数字 / 面议 / 跳过无效词 / 混用合规 |
| tests/rubric/differentiator_density.test.ts | 3 | 全具体 / 占比 / 空表 |
| tests/rubric/strategic_insight.test.ts | 4 | 返回结构 / mock 差异化 / rationale / 区间 |
| tests/fixtures/public-competitor-sample.test.ts | 2 | SaaS / OSS 无硬违规 |
| tests/fixtures/golden-set-expanded.test.ts | +5 | P4.6 块(含 id / 无违规 / detection 触发 / 不重复) |
| tests/cross-family/intel-table.test.ts | 更新 | v1.1 计数(6 谓词 / 4 det rubric) |
| tests/qa/p1-acceptance.test.ts | 更新 | §3.5 谓词数 3→6 |

---

## 常见坑

1. **`npx tsx -e` 相对 import 失败**:跑内联检查时从临时位置加载,找不到 `./src/...`。
   → 用项目内 `scripts/_smoke-intel.ts` 或直接跑 `npm run intel:monitor`。
2. **strategic_insight 不在 deterministic.rubric_scores**:基础 scorer(同步)只跑 4 个确定性维度;
   要看完整 5 维必须用 `createJudgeAugmentedScorer`(async,demo 脚本已用)。
3. **stale_pricing 参考日期固定 2026-06-25**:测试时间无关,但若改 freshness.ts 的参考日期需同步改 stale_pricing.ts。
4. **pricing_format vs unit_consistency 重叠**:"未知/n/a" 由 pricing_format(hard)报,unit_consistency 跳过;
   裸数字(如 "299")通过 pricing_format(含数字)但被 unit_consistency(soft)报单位缺失。

---

## 风险提示

- **公开快照是脱敏合成**:形态真实(字段结构、来源标注、可信度分配)但数据为构造,
  非真实厂商情报。真实网页抓取(HTML→Artifact)留待 P4.6.2 collector。
- **strategic_insight mock fallback 是近似**:无 LLM 时基于结构特征(竞品数 + coverage)给分,
  不能替代真实语义判断。生产部署应配置 `OPENAI_API_KEY` 走真实 judge。
- **stale_pricing 阈值 180 天是经验值**:不同行业定价更新频率不同(快消 < SaaS < 重型设备),
  生产可按行业调 `makeStalePricing(maxAgeDays)`。
