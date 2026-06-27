# Crucible DSL v1 — 开放标准草案

> 版本: 0.1 (P3 草案)
> 日期: 2026-06-27
> 状态: Draft for review
> 目标: 定义契约驱动合成引擎的 DSL 开放标准,使任意实现遵循此 schema 即可互换

---

## §1. 概述

### 1.1 设计目标

Crucible DSL 是一种 **契约驱动合成引擎** 的声明式描述语言。它把"多智能体协作的协调基质"从聊天消息升级为**可执行契约**:

- **可执行**: 契约编译为运行时检查器(谓词 + 评分器)
- **共享**: 所有 agent 围绕同一份契约协同(读写同一文件)
- **可演化**: 版本化 + diff 驱动(ContractPatch)
- **可校准**: 黄金集 + Kendall τ 校准 judge 排序
- **跨族**: 同一套 schema 可应用于不同 artifact_family(sequence/table/brief/roster)

### 1.2 核心概念

| 概念 | 说明 |
|------|------|
| Contract | 可执行的 YAML/JSON 契约文档 |
| Artifact | 被评估的工件(节点序列/表格/简报等) |
| Predicate | 硬约束检查函数(Artifact → Violation[]) |
| Rubric | 质量维度评分(deterministic / judge / proxy+judge) |
| Score | 综合分数(deterministic × 0.6 + judge × 0.4) |
| Calibration | 黄金集 + 人类排序 + Kendall τ 校准 |
| ContractPatch | 契约修订 diff(加字段/约束/调权重) |

### 1.3 与传统 DSL 的区别

| 维度 | 传统 DSL(如 OpenAPI) | Crucible DSL |
|------|---------------------|-------------|
| 用途 | 接口契约 | 合成契约(协作基质) |
| 评估 | 结构校验 | 结构 + 质量(judge) |
| 演化 | 版本号 | 版本号 + diff + 校准回归 |
| 实现 | 客户端/服务端各自实现 | 一份契约驱动多 agent |

## §2. Schema 规范

### 2.1 顶层结构

```yaml
artifact_family: sequence | table | brief | roster
fields: [FieldDef, ...]
hard_constraints: [HardConstraint, ...]
rubric: [RubricEntry, ...]
calibration: Calibration
metadata:                  # 可选
  version: integer         # 契约版本号(ContractPatch 应用后 +1)
```

### 2.2 FieldDef

```yaml
- name: string             # 字段名
  type: string | integer | number | enum | string[]
  required: boolean
  values: [string, ...]    # 仅 type=enum 时必填
```

### 2.3 HardConstraint(discriminated union)

```yaml
# Declarative(声明式约束)
- id: string
  type: declarative
  rule: string             # 自然语言描述(供 LLM/人类阅读)
  mutex: [string, string]  # 互斥 token 对(可选,触发 makeStateMutex)

# Code Predicate(代码谓词)
- id: string
  type: code_predicate
  impl: string             # JS 代码字符串,定义 function check(artifact) → Violation[]
  threshold: number        # 可选阈值参数
```

### 2.4 RubricEntry

```yaml
- dim: string              # 维度名(routing/memorability/dining_fit/cost_fit/source_trust/...)
  weight: number           # 0.0-1.0,全部 rubric 权重 sum = 1.0
  mode: deterministic | judge | proxy+judge
```

### 2.5 Calibration

```yaml
calibration:
  frozen_golden_set: string    # 黄金集 JSONL 文件路径
  metric: kendall_tau | spearman_rho
  human_ceiling: string        # 可选,人类一致性上限说明
```

## §3. 约束类型

### 3.1 Declarative 约束

声明式约束由实现侧提供谓词函数,编译器按 `id` 映射:

| id | 语义 |
|----|------|
| continuity | 相邻节点必须有 transit/switch 桥接 |
| state_mutex | 互斥 state token(同节点 + 相邻节点) |
| time_budget | 总 duration 不超过 daily_available_minutes |
| no_duplicate_state | state token 不能连续两节点持有(除非 clearing) |
| no_empty_source | 每行必须有非空 source 字段(table 族) |
| pricing_format | pricing 必须含数字或"免费"(table 族) |
| no_duplicate_competitor | competitor_name 不能重复(table 族) |

### 3.2 Code Predicate 约束(沙箱)

允许契约携带自定义谓词代码:

```yaml
- id: custom_check
  type: code_predicate
  impl: |
    function check(artifact) {
      return artifact.nodes.length > 10
        ? [{ constraint_id: 'custom_check', severity: 'hard', message: '...', location: {} }]
        : [];
    }
```

**安全要求**: 实现必须用沙箱执行(isolated-vm / vm),禁止 require/fs/network/eval,
执行超时 ≤ 1000ms,内存上限 ≤ 128MB。

### 3.3 Violation 结构

```yaml
constraint_id: string
severity: hard | soft
message: string
location:
  node_index: integer       # 可选
  node_index_end: integer   # 可选(跨节点)
  field: string             # 可选
fix_hint: string            # 可选,修复建议
```

## §4. Rubric 模式

### 4.1 deterministic(确定性)

纯函数 Artifact → RubricScore。无 LLM 调用,可重现。
示例: `cost_fit`(总成本/预算)、`source_trust`(来源可信度平均)、`coverage`、`freshness`。

### 4.2 judge(LLM 判定)

LLM 调用,返回 0.0-1.0 分数。无 API key 时降级返回 0.5(neutral)。
示例: `memorability`(独特体验)、`dining_fit`(餐饮匹配)。

### 4.3 proxy+judge(代理 + 判定)

先算确定性代理指标(如 routing 桥接覆盖率),再让 LLM 参考代理打分。
示例: `routing`(代理: 桥接覆盖率; judge: 综合动线评分)。

### 4.4 缺失数据默认值

- **无基准 = 中性 0.5**: 评估基准缺失(如 cost_fit 无 budget),返回 0.5
- **无证据 = 0.0**: 被评估物缺失(如 source_trust 无字段),返回 0.0
- **空 artifact = 中性 0.5**: 整个 artifact 无节点,返回 0.5(无证据 ≠ 坏)

## §5. 版本治理

### 5.1 版本号

`metadata.version`(integer):每次 ContractPatch 应用后 +1。
若契约无 metadata.version,视为 v1。

### 5.2 ContractPatch

```typescript
type ContractPatch =
  | { op: 'add_field', field: FieldDef, reason: string }
  | { op: 'remove_field', field_name: string, reason: string }
  | { op: 'add_constraint', constraint: HardConstraint, reason: string }
  | { op: 'remove_constraint', constraint_id: string, reason: string }
  | { op: 'adjust_weight', dim: string, new_weight: number, reason: string }
  | { op: 'add_rubric', rubric: RubricEntry, reason: string }
  | { op: 'remove_rubric', dim: string, reason: string };
```

### 5.3 应用规则

- 幂等: 同 id/name 不重复加
- 归一化: rubric 权重应用后自动归一化(sum=1.0)
- 版本递增: 默认 +1,可选不递增

### 5.4 兼容性

- **Forward compat**: 加 optional 字段(metadata 等),旧编译器忽略未知字段
- **Backward compat**: 删 optional 字段,新编译器接受
- **Breaking changes**: 改 schema 结构(rubric.mode 枚举变更),需主版本号+1

## §6. 跨族兼容

### 6.1 artifact_family

| family | 工件结构 | 节点语义 |
|--------|---------|---------|
| sequence | 节点序列(有时间顺序) | 行程步骤 / 工作流步骤 |
| table | 节点表格(无顺序) | 表行 / 数据条目 |
| brief | 单工件 | 简报 / 文档 |
| roster | 角色列表 | 人员名单 / 资源清单 |

### 6.2 适配器模式

外部数据源 → Artifact 的转换由适配器负责:

```typescript
interface ArtifactAdapter {
  source: CollectionSource;
  name: string;
  validate(raw: unknown): string | null;  // null = 合法
  adapt(raw: unknown): Artifact;
}
```

任意数据源(报告 PDF / API JSON / 文本攻略)都可写适配器,转为标准 Artifact。

### 6.3 跨族 go/no-go(P1 §2.8 验证)

同一套 DSL schema(fields+constraints+rubric)无需修改即可跨族使用。
P1 探针: travel-sequence-v1.yaml 和 intel-table-v1.yaml 共用同一 schema,
3 个新谓词 + 2 个新 rubric 注册到 compiler,bug 100% 抓出。

## §7. 校准(Calibration)

### 7.1 黄金集

冻结的 N 个工件(P1 §2.3: N=8),覆盖不同质量梯度(high/mid/low)。
存储为 JSONL: `golden/hk-3day-v1.jsonl`,每行一个工件。

**冻结要求**: 黄金集永不进 few-shot,只用于校准回归。

### 7.2 人类排序

通过 pairwise comparison 由人类标注:
- 排序维度: "整体感受(综合时间/动线/记忆点/餐饮/来源)"
- 标注方法: ~17 轮 pairwise(merge sort + tie resolution)
- 产出: `golden/human-ranking.jsonl`

### 7.3 Kendall τ

```
τ = (concordant - discordant) / (n * (n-1) / 2)
```

- τ ∈ [-1, 1]: 1=完全一致, 0=无关, -1=完全相反
- **阈值**: τ > 0.5 可接受, τ > 0.7 良好

### 7.4 P1 实测结果

| 阶段 | overall τ | 备注 |
|------|----------|------|
| 迭代 1 | 0.36 | memorability 负相关 -0.29 |
| 迭代 2 | 0.50 | 调整 prompt 后 memorability 转正 |
| 迭代 3 | **0.64** | det_score 公式修复(含 rubric_avg)→ PASS |

## §8. 开放性

### 8.1 互换性原则

任何实现遵循本 schema 即可互换:
- 输入: 符合 §2 schema 的 Contract YAML/JSON
- 输出: 符合 §3.3 Violation 结构的违规列表 + 符合 §4 模式的 rubric 分数
- 工作流: 符合 §5 版本治理

### 8.2 参考实现

Crucible(本项目)是 v1 的参考实现:
- TypeScript + Vercel AI SDK + Zod
- 沙箱: isolated-vm
- MCP server: JSON-RPC 2.0 over stdio
- 测试: vitest

### 8.3 其他实现的指南

要写一个兼容实现:
1. 解析 Contract YAML,用 zod 校验 schema
2. 实现 §3.1 declarative 约束的谓词函数
3. 实现 §3.2 code_predicate 的沙箱执行
4. 实现 §4 rubric 模式(deterministic + judge LLM)
5. 实现 §5 ContractPatch 应用 + 版本递增
6. 实现 §7 黄金集校准 + Kendall τ
7. (可选)实现 §6 跨族适配器

### 8.4 标准化路径(P3+ 草案,P4+ 提交)

- P3: 草案撰写(本文档)
- P4: 社区评审 + 修订
- P5: 提交标准化组织(待定)

## 附录 A: 完整 Contract 示例

```yaml
artifact_family: sequence
metadata:
  version: 1
fields:
  - {name: action, type: string, required: true}
  - {name: duration_min, type: integer, required: true}
  - {name: node_type, type: enum, required: true, values: [transit, dining, core_experience]}
  - {name: state, type: 'string[]', required: false}
hard_constraints:
  - id: continuity
    type: declarative
    rule: "每对相邻节点必须有 transit/switch 桥接"
  - id: state_mutex
    type: declarative
    mutex: [luggage_drop, depart_from_hotel]
rubric:
  - {dim: routing, weight: 0.5, mode: proxy+judge}
  - {dim: source_trust, weight: 0.5, mode: deterministic}
calibration:
  frozen_golden_set: golden/sample-v1.jsonl
  metric: kendall_tau
```

## 附录 B: 引用

- PRD v1.2 (Crucible 产品需求文档)
- P0-P3 Spec(本仓库 `docs/superpowers/specs/`)
- 实现参考: `github.com/[org]/crucible`(本仓库)
