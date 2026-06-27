# 冻结黄金集治理 (P3.5 §2.4 / OQ-16)

> P1 黄金集 8 工件(港/滇/防城港)是手工冻结,无规模/构造/防腐规则。
> P3.5 建立正式治理流程:规模目标、构造规则、重建周期、防腐协议。

## 1. 现状

- **工件数**:8(`src/fixtures/golden-set.ts` GOLDEN_ARTIFACTS)
- **覆盖**:3 区域(香港 3 / 云南 3 / 防城港 2)× 3 质量梯度(high/mid/low)
- **用途**:judge 校准回归(P1 Kendall τ)、新颖度 v2 分布统计基线(P3.5 §2.3)
- **问题**:规模偏小(分布统计 n 不足);无异常 case;无重建/防腐规则,长期漂移无人发现

## 2. P3.5 规模目标:8 → 20-30

按覆盖率矩阵构造,确保各维度都有样本:

| 维度 | 取值 | 目标样本数 |
|------|------|-----------|
| artifact_family | sequence / table | sequence 为主(P1 基线),table 探针 ≥ 3 |
| region | hongkong / yunnan / fangchenggang / intel(情报表) | 每个 ≥ 4 |
| quality_tier | high / mid / low | 每个 ≥ 6 |
| violation pattern | none / time_budget / state_mutex / duplicate_state / continuity | 异常 case ≥ 6 |

**P3.5 落地**:扩到 **≥ 20 工件**(见 `src/fixtures/golden-set-expanded.ts`)。新增覆盖:
- 防城港补 mid(现仅 high+low,梯度不全)
- 情报表族(table)3 个探针(P2 cross-family 探针数据可复用)
- 异常 case:故意构造的 time_budget 超限 / state_mutex 冲突 / 重复 state / continuity 断裂

## 3. 构造规则

1. **基线原则**:黄金集工件本身**无硬违规**(否则不能当校准基线)。质量差异体现在 judge 维度。
2. **异常 case 例外**:P3.5 新增的 violation pattern 异常 case **故意含硬违规**,用于测试
   打分器/契约能否**检出**这些模式。它们**不进** judge τ 校准(只进检出率测试),
   在 GOLDEN_ARTIFACTS 中用 `purpose: 'detection'` 标记区分(`purpose: 'calibration'` 为默认)。
3. **来源可信度**:每个工件节点带 `source` + `source_trust`,覆盖 0.25-1.0 全梯度。
4. **数值分布**:cost / duration_min / source_trust 在黄金集内要有足够方差,
   供 novelty v2 distribution outlier 检测有统计意义(n ≥ 2 且 std > 0)。

## 4. 重建周期

- **触发条件**(满足任一):
  - 契约演化累计 ≥ 5 次
  - 季度 review
  - novelty v2 报告黄金集自身出现 distribution outlier(说明黄金集漂移)
- **执行**:`scripts/audit-golden-set.ts` 跑审计 → 人审新增/剔除 → 更新 fixture
- **回归保护**:重建后必须重跑 P1 Kendall τ 校准,确认 τ ≥ 0.6 阈值不破

## 5. 防腐协议(每次契约演化后执行)

`scripts/audit-golden-set.ts` 检查三项:

1. **分数分布漂移**:对每个数值字段算黄金集均值/标准差,与上次审计快照对比,
   均值漂移 > 20% 或 std 变化 > 30% → 告警(黄金集可能被污染或漂移)。
2. **judge τ 下滑**:重跑 judge 校准,人类排序 vs judge 排序 Kendall τ;
   τ 较上次 < -0.1 → 告警(judge 可能退化或黄金集排序失真)。
3. **覆盖率矩阵**:检查 artifact_family × quality_tier × violation pattern 是否仍有
   最小样本数;缺口 → 告警(需补样本)。

输出:`docs/qa/golden-set-audit-YYYY-MM-DD.md` 报告。

## 6. P3.5 落地物

- `docs/governance/frozen-golden-set.md`(本文档)
- `src/fixtures/golden-set-expanded.ts`(扩容到 ≥ 20 工件,带 purpose 标记)
- `scripts/audit-golden-set.ts`(自动化审计脚本)
- `tests/fixtures/golden-set-expanded.test.ts`(扩容集结构 + 覆盖率矩阵测试)

## 7. 关闭的 Open Questions

- **OQ-16 (冻结集防腐)**: 治理文档 + 审计脚本 + 扩容落地,关闭。
