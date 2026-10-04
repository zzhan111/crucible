# 访谈 → 契约 → 评分：Crucible 专家知识层 产品设计文档 v0.2

> 日期：2026-10-04（Asia/Shanghai）｜作者：Zink Zhang（草稿由 Grok Bot 整理）｜状态：**草案 v0.2，待评审**
> 上一版：`2026-10-04-interview-to-contract-design-v0.1.md`（保留不动）｜评审：`2026-10-04-codex-review.md`（结论"需修改后推进"）
> 代码基线：`zzhan111/crucible` main@`b792927`（只读 `/tmp/crucible-ro`，`git status` 始终干净）。
> 核实方式：评审中所有影响设计的代码断言，我都对照源码逐条读过，并在独立副本 `/tmp/probe-v02` 中无 API key 跑了探针；脚本与示例存于 `/home/box/crucible-design/probe-v02/`（结果见附录 C）。
> 标注：**【假设】**未验证的设计假设｜**【待定】**需 Zink 决策（★ = 最关键的 3 个）｜**【依赖 Dx】**引擎依赖项。本文不含任何产品层面的实测结果。

## 变更记录（v0.1 → v0.2）
- **修正事实错误**：v0.1 把 `metadata` 标成"引擎读取的兼容核心"，这是错的。现有 `ContractSchema` 根本没有 `metadata` 键，各层嵌套里的未知键都会被静默剥离。§2.3 增加逐字段的"引擎实际行为"表。
- **示例 YAML 重写**：v0.1 的示例因权重和 ≠ 1 加载失败；改权重后，一条明显违规的行得到 det=1.0、final=0.6（已复现）。v0.2 示例按 schema v2 写，已用草拟的 v2 zod schema 验证通过；同时给出能被当前引擎加载的 v1 投影，并写明它几乎不起作用。
- **契约身份/版本（D0、D9）**：`(contract_id, version)` 作为身份，版本号为整数，缓存 key 含编译后的契约内容 hash 和模型/提示版本，schema v2 对未知键报错（`.strict()`）。
- **新增引擎依赖**：D0、D11 评估上下文（不再写死参考日期）、D12 行级评分、D13 fail-closed、D14 校准读契约配置、D15 契约变更语义；D16（judge 刻度）并入 D7。D 表补上 Codex 的判定和我的复核。
- **规则 fail-loud**：原语作为 `type: primitive` 独立分支（旧引擎直接拒绝）；参数逐原语定义 schema；例外编译成 `unless` 条件；谓词出错 ≠ 通过；空 rubric、缺 judge 不再给默认分。
- **溯源从"原话存在"升级到"原话支持"**：子串校验 + 数值落地 + 人话回译确认卡 + 独立 Verifier 抽检（"支持率"）。
- **MVP 缩小，按"样本优先"重排**：新增 S1.5 快速分档；里程碑改为 M0a 引擎最小集 → M1 样本优先闭环（无访谈）→ M2 访谈 + 访谈者评测 → …；新增 §3.7 访谈者自身评测。
- **校准纪律**：防止样本内评估；holdout 必须在专家看到任何契约打分之前排好；埋雷检出率降为编译器回归测试；给出 τ 标准误表；标准档不做 holdout、不拟合权重；"已校准"标签只给深度档。
- **数据**：v1 只做 CSV/xlsx；断言用确定性代码编译成 SQL（LLM 不写 SQL）；DuckDB 锁定外部访问；画像先脱敏；契约记录数据快照 hash。
- **取消 `blend`**：只保留一组跨确定性和 judge 的权重（旧契约沿用 0.6/0.4）【待定】。

---

## 1. 定位

### 1.1 一句话
**让任何领域的专家通过一场"会追问、会对数据"的对话，把自己的判断变成一份可执行、可溯源、并且量过与本人判断一致度的 Crucible 评分契约。**
流水线：**访谈（反弹） → 契约 → 评分**。入口不预设领域，用户自己定义场景，用户本人就是专家。
对外措辞：说"已度量一致度（附样本数与置信区间）"，不说"已校准"；"已校准"标签只给满足 §3.6 门槛的深度档版本。

### 1.2 目标用户
| 用户 | 例子（仅示意，均不是试点） | 需要 |
|---|---|---|
| 领域专家（主） | 店长判断单个 SKU 是否符合顾客预期；医药采购判断采购单；分析师判断竞品情报表 | 不写代码，把经验变成标准，并看到标准与自己判断是否一致 |
| AI 应用构建者（次） | 给生成 agent 找一个懂行的评测器 | 通过 MCP 拿到**版本冻结**的契约；有弃用策略和变更通知（§7.3） |

### 1.3 非目标（v1）
- 不做通用聊天助手；不内置行业模板。
- 不做多专家共识；**但数据模型从第一天起给每条原话、每次排序带上 `expert_id`**。
- 不让专家或 LLM 写 `code_predicate`（专家看不懂代码、没法溯源、没法回译确认；沙箱也只是 `node:vm`）。表达不了的规则进 `needs_impl` 队列，由工程师实现成新原语。
- 不做 BI；v1 不解析 docx/pdf；不做实时语音；不直连 ERP/POS。
- 不负责生成被评工件（P3）。
- 涉及人的评价场景（如招聘）：v1 加敏感属性 lint（年龄/性别/籍贯等），是否整体排除【待定】。

---

## 2. 核心概念

### 2.1 Session = Scenario
- 聊天式界面：一个会话 = 一个场景 = 一份契约（带版本史）。库表叫 `scenario_sessions`，避免和现有认证表 `sessions`（`003_users_sessions.sql`，存 token）重名。
- 场景槽位：`artifact`（被评对象）｜`purpose`（谁用分数做什么决定）｜`stakes`（放过坏的 vs 错杀好的，哪个代价大）｜`data`（可附数据）｜`outcome`（事后结果信号，可空）。
- **`stakes` 必须被下游用上**：决定校准报告突出误拒率还是漏放率、数据试跑时阈值偏松还是偏严的提示，以及升级到 gate 时的提醒语气。它**不**自动决定 gate/penalty。
- **评价单元（与 D12 相关）**：v1 引擎层只做 **artifact 级**评分和排序，行 = node。"逐个 SKU 判断"这类按条目判断的场景，建模成**单 node 的 artifact + 评估上下文**（品类、销量等通过 D11 注入）。这样 v1 不需要行级评分，也能覆盖按条目判断的场景。只有"一份多行单据，且要逐行给分"才需要 D12。
- v1 只支持 `table` 族【待定 ★2】。

### 2.2 访谈状态机

```
S0 定义场景 → S1 读数据 → S1.5 快速分档 → S2 访谈(反弹) → S3 结构化草稿 → S4 样本排序 → S5 校准 → S6 发布
                 ▲              (8–10 个真实工件，好/中/差 + 一句理由)                 │
                 └──────────── 回退：冲突 / 点评 / 排序残差 / 结果数据，携带具体问题 ──────┘
```

| 状态 | 做什么 | 退出条件（门槛均为【假设】） |
|---|---|---|
| S0 | 填槽位 | `artifact/purpose/stakes` 已填 |
| S1 | 表结构确认（表头/数据区/汇总行）→ 脱敏画像 → 生成问题 | 专家确认表结构 |
| **S1.5 快速分档（新增）** | 专家先把 8–10 个真实工件分成 好/中/差，各写一句理由；**这批只作训练样本，不进 holdout** | 完成分档 |
| S2 | 访谈围绕"你为什么把 A 放在差档"展开，并追问、反弹 | §3.4 清单达标，或专家选择"先出草稿" |
| S3 | 确定性编译 + 真实数据试跑 + 回译确认卡 | `needs_impl`=0、`disputed`=0 或明确挂起 |
| S4 | 生成训练批和 holdout 批（holdout 在专家**看到任何契约分数之前**排好） | 达到档位样本数 |
| S5 | τ-b + CI、残差分析；埋雷回归测试 | 见下方发布门槛 |
| S6 | 冻结 `(contract_id, version)`，编译 YAML + 溯源包，经 MCP 暴露 | — |

**发布门槛（客观项，不能只靠专家自认）**：`needs_impl`=0；`open` 冲突=0（并公开 `accepted_divergence` 的占比）；埋雷回归 100% 检出（这是编译器正确性测试）；专家判为"好"的真实样本被 gate 误拒数=0 或逐条确认；所有条目均已过回译确认。
**过期机制**：每个条目和每份报告都记录它依赖的契约版本和数据快照 hash；任一项变化后自动标"过期"（例如权重变了，旧 τ 失效）。会话恢复时显示"停在哪、哪些已过期"。

### 2.3 契约对象模型

两层：**ContractSpec**（中间层的工作对象：溯源、状态、例子、冲突、测试样本）→ 由**确定性编译器**生成 **Crucible YAML**。编译产物里写入 `spec_hash`、`compiler_version`、`provenance_hash`，防止 YAML 和溯源包互相漂移。

#### 2.3.1 当前引擎实际会怎样处理（已核实）
`ContractSchema`（`src/contract/schema.ts:41-51`）只有 `artifact_family/fields/hard_constraints/rubric/calibration` 五个键，6 处 `z.object` 都是默认的 strip 模式，所以**每一层**的未知键都会被静默剥离：

| 写法 | 当前引擎行为 |
|---|---|
| 顶层 `metadata`（含仓库自带 `intel-table-v1.yaml` 的 `version: 1.1`） | 剥离。于是 `augmented.ts:26` 的版本恒为 `'v1'`，持久化版本恒为 1 |
| 顶层 `blend`、`evidence_requirements`、`source_tiers`、`context` | 剥离；0.4 写死在 `augmented.ts:9` |
| `fields[]` 的新属性（unit/binding/…） | 剥离；字段本身只校验定义，不校验工件里的值 |
| `hard_constraints[]` 的 `primitive/params/enforcement/exceptions…` | 剥离；未注册的 id 只 warn 后跳过（`compiler.ts:86-92`） |
| `type: primitive`、字段类型 `boolean` | **加载失败**（不在枚举/判别联合里）——这正是 v2 想要的 fail-loud |
| `rubric[]` 的新属性；未注册的 judge 维度 | 剥离；judge 维度被 `fanout.ts` 静默丢弃，但权重仍算在分母里 → judge=0 |
| 没有任何确定性 rubric | `rubricAvg = 1.0`（`compiler.ts:132-134`） |
| `calibration.frozen_golden_set/metric` | 能通过 schema，但**没有任何代码读取**；校准永远用 8 个旅行工件算 τ-a |
| `metric: kendall_tau_b` | 加载失败 |

#### 2.3.2 示例（schema v2 目标形态；虚构的采购场景，仅示意）
已用草拟的 v2 zod schema（`probe-v02/schema-v2-draft.ts`，**不是**仓库改动）验证：能加载；改错一个键名、或权重和 ≠ 1，都会被拒。

```yaml
schema_version: 2
metadata:
  contract_id: "c_7f3a"
  version: 3                        # 整数；身份 = (contract_id, version)
  status: draft                     # draft | calibrating | published
  scenario_id: "s_12"
  spec_hash: "sha256:…"             # ContractSpec 规范化 hash（编译器写入）
  compiler_version: "elicit-0.2.0"
  provenance_hash: "sha256:…"       # sidecar provenance.json 的 hash
  data_snapshot: { pos_sales_30d: "sha256:…" }
artifact_family: table
evaluation_unit: artifact           # v1 只允许 artifact（D12）

context:                            # D11 评估上下文
  as_of: required                   # 评分时必须传入，不再写死 REFERENCE_DATE
  ref_tables:
    - name: pos_sales_30d
      key: sku_id
      columns: { sales_30d: number, category: string }
  bindings:                         # 评分前确定性 join，把参考列物化进 node
    - { field: sales_30d, from: pos_sales_30d.sales_30d, on: sku_id, on_missing: error }

fields:
  - { name: sku_id,     type: string,  required: true }
  - { name: order_qty,  type: integer, required: true, unit: "盒" }
  - { name: is_new_sku, type: boolean, required: true }
  - { name: sales_30d,  type: number,  required: true, origin: binding }

hard_constraints:
  - id: qty_vs_30d_sales
    type: primitive                 # 第三个分支：旧引擎直接拒绝，而不是跳过
    primitive: ratio_threshold
    params: { numerator: order_qty, denominator: sales_30d, op: "<=", value: 2.0, on_zero_denominator: violate }
    unless: [{ field: is_new_sku, op: "==", value: true }]   # 可执行的例外
    scope: node
    enforcement: penalty            # 默认 penalty；升 gate 见 §3.2
    penalty: 0.15
    rule_text: "单次采购量不超过近 30 天销量的 2 倍（新品首单除外）"
    item_ref: "spec://c_7f3a/hr_01" # 溯源/状态/测试样本在 ContractSpec 里

rubric:                             # 一组权重，确定性 + judge 合计 = 1；不再有 blend
  - dim: stock_cover_fit
    weight: 0.5
    mode: deterministic
    primitive: band
    params:
      metric: { ratio: [order_qty, sales_30d] }
      bands: [{ max: 0.5, score: 0.4 }, { max: 1.5, score: 1.0 }, { max: 2.0, score: 0.6 }]
      else_score: 0.0
    aggregate: mean
  - dim: category_balance
    weight: 0.2
    mode: deterministic
    primitive: share_cap
    params: { group_by: category, max_share: 0.4 }
  - dim: substitution_risk
    weight: 0.3
    mode: judge
    judge:
      template: generic_v1          # D7 通用 judge
      question: "缺货时顾客是否有可接受的替代品？"
      inputs: [sku_id, category]    # 字段白名单
      scale: { min: 1, max: 5 }     # 引擎负责归一化；不经过 parseJudgeScore
      samples: 3
      aggregate: median

calibration:
  golden_set_ref: "golden/c_7f3a/v3.jsonl"   # D14：校准真正读取这里
  metric: kendall_tau_b
  holdout: none                     # 标准档不强制 holdout（§3.6）
```

**v1 投影（今天就能加载，但几乎没作用）**：只保留旧键，把 `boolean→string`，约束改成 `declarative`，`metric: kendall_tau`。探针结果：能加载；0 个谓词、0 个确定性 rubric、3 条编译告警（judge 维度被丢弃，**连告警都没有**）；对 `order_qty=9999, sales_30d=1` 这样的违规行给出 det=1、judge=0、final=0.6。**结论：在 D0/D6/D7/D11/D13 落地前，访谈产出的契约不能交给引擎用于评分。**

#### 2.3.3 schema 决策
- **schema v2 严格模式**：`schema_version: 2` 的契约在每一层都 `.strict()`，有未知键就报错；没有 `schema_version` 的旧契约走兼容分支，保持现有行为（包括 0.6/0.4）。
- **版本号用整数**（DSL 规范 §2.1、§5.1 已规定；`sink.ts:37-41` 遇到非整数会抛错）。
- **只有一组权重**：v2 去掉 `blend`，`final = Σ wᵢ·sᵢ`，只对当前可评估的维度重新归一。专家只需要理解一组权重。审计指出：intel 契约里 judge 名义上占 20%，实际占 40%。
- **退化语义**：某个维度无法评估时记为 `n/a`，并在报告里显式列出，**不**给 1.0 或 0.5。
- **原语库 v1**：`required`、`enum_in`、`range`、`regex`、`unique`、`ratio_threshold`、`cross_field`、`lookup_in_ref`、`share_cap/aggregate_threshold`、`group_compare`（如"高于同类目中位数 30%"）、`date_window`（以 `ctx.as_of` 为基准，freshness 是它的特例）、确定性评分用的 `band`；修饰符 `unless/when`。每个原语的 `params` 单独写 zod schema，引用的字段必须存在于 `fields`。
- **ID 作用域**：样本、测试用例 ID 一律带契约前缀（`c_7f3a/g_04`）。
- **证据层**：`source_tiers` 要求工件按单元格携带来源（如 `unit_price_source`），工件侧怎么表示证据是 D10 的前置设计。v1 不交付证据层。

---

## 3. 中间层设计（重点）

| 角色 | 职责 | LLM? |
|---|---|---|
| Interviewer | 缺口队列 → 下一个问题 | 是 |
| Extractor | 只抽"专家说了什么"（陈述、例子、断言），跨轮合并 | 是 |
| **Formalizer（从 Extractor 拆出）** | 陈述 → 原语提议（含参数）→ 生成回译卡 | 是 |
| **Verifier（新增，不参与生成）** | 判断"原话→条目"是否蕴含；把问题分类为开放式或诱导式 | 是（另一套 prompt，最好用不同模型） |
| Reconciler | 断言 → **确定性 SQL** → 判定 | 只负责"自然语言→断言+列绑定" |
| Compiler / Calibrator | Spec→YAML；τ-b/CI；回归测试 | 否 |

LLM 输出一律走"解析 + zod 校验 + 重试 1 次 + 失败计数"。仓库现有的 `callLLMJson` 只做 `JSON.parse`，`contractAuthorRevise` 直接 `as ContractPatch[]`，都不能直接复用；Live Env 事件源的 zod 校验 + 回落可以作为样板。

### 3.1 抽取
- 增量、**异步**（不拖慢访谈回复）；同一条规则散在多轮（第 3 轮说"太多"、第 7 轮说"两倍吧"）时做合并，`quote_refs` 支持多段、跨轮。
- LLM 自报的 `confidence` 只用来决定提问顺序，不用于任何门槛。
- 只有专家发言轮次能作为溯源来源；上传数据、文档里的文字不能"植入"规则（防提示注入）。

### 3.2 溯源：从"存在"到"支持"
1. **子串校验**（保留）：`verbatim` 必须是不可变原始转写的精确子串。`char_span` 以 **Unicode 码点**为单位，基于 append-only 转写；比较前做规范化（全半角、空白），但存档保留原文。
2. **数值落地**：`params` 里的每个数字都必须能从引用原话中确定性解析出来（"两倍"→2、"一个月"→30 天，用规则表解析）；解析不出、或原话是区间/模糊表达（"两倍左右""一倍多"）时，必须经过确认卡由专家选定数值。
3. **回译确认卡**：Formalizer 把编译后的原语回译成一句人话，例如"系统理解为：采购量 ÷ 近 30 天销量 ≤ 2.0；新品首单除外；违反时扣分（不是直接不合格）"。专家点确认或修改。溯源记录的是**卡片快照 hash + 确认动作 + expert_id**，不是一句"嗯，可以"。`ai_suggested` 和侧栏 `direct_edit` 的条目同样要过 2、3 两道闸，否则编辑栏就成了绕开溯源的后门。
4. **抽检（质量指标）**：Verifier 对每个条目判断原话是否蕴含该条目，分歧交给专家；用**支持率**作为质量指标，替代 v0.1 的"原话覆盖率"（覆盖率 100% 只是门槛，给的是虚假的安全感）。另外定期人工抽检一部分【假设：比例待定】。
- **gate 升级条件**：新规则默认 `penalty`。升为 `gate` 需同时满足：专家在确认卡上明确选了"直接不合格"；在真实数据试跑中，专家判为"好"的样本被拒数为 0 或逐条确认。

### 3.3 冲突检测
- 类型：专家 vs 数据｜专家 vs 专家（**按字段/维度分桶**，只在桶内比较，避免 O(n²)）｜专家 vs 自己的排序（小样本时单个反例可能是噪声，所以**作为追问，不要求清零**）｜**数据 vs 数据**（如 ERP 采购量和 POS 出库对不上）。
- 结局：`expert_revised | data_wrong | accepted_divergence`。公开 `accepted_divergence` 的占比，以及"专家改口到恰好等于数据值"的比例（作为锚定信号）。

### 3.4 完备度清单（何时访谈够了）
门槛均为【假设】。**完备 ≠ 正确**：界面上只说"结构完整"。

| 检查项 | 判定 |
|---|---|
| 场景槽位 | 已填 |
| 规则可执行 | 每条规则有原语、参数、范围、可执行例外；`needs_impl`=0 |
| 规则有测试 | 每条 gate 至少 1 个通过例 + 1 个违反例 |
| 维度可操作 | 定义 + 可观察信号 + ≥1 好例 + ≥1 坏例（S1.5 分档天然提供） |
| 权重 | 从取舍题和分档**推断**，再请专家确认（不直接问"各占多少"） |
| 数据列覆盖 | 每一列要么已绑定，要么专家明确说"无关" |
| 数据对账 | 可检验断言都已检验；`open`=0 |
| 区分度（硬项） | 没有规则/确定性维度在真实数据上全过或全挂（审计教训：`cost_fit` 全为 1.0），否则需专家确认是预期 |
| 分歧已解释 | S5 分歧最大的 3 对都有解释 |
| 饱和 | 最近 N 个**针对性问题**都得到实质回答且没有新条目（不是"最近 N 轮"，以免把专家疲劳误判为饱和） |
| 溯源 | 已确认条目 100% 过三道闸 |

### 3.5 反弹策略
- 触发器沿用 v0.1：模糊词、绝对化、无例子、数据冲突、前后矛盾、不可观察、硬软不明、硬规则过多、权重不明。"不确定性"用可计算的代理来衡量：缺阈值、缺例子、存在冲突、只有一段原话。
- **先问后亮**：遇到数据冲突，先问"这个'一倍'是怎么得出来的，指哪段时间、哪些品？"，再展示数据，以减轻锚定。
- **诱导检测不只靠 prompt**：Verifier 给每个问题分类，统计诱导率（如"是不是应该 X？"这种封闭式），作为回归指标。
- 同一条目最多反弹 2 轮，之后记为 `expert_asserted`；每轮最多一个反弹点；语气是请教，不是辩论。
- 投入档位：快速（gate 规则 + 前 3 维 + 10 个样本 → 草稿，不可发布）｜标准（20 个样本，可发布，标"一致度未确证"）｜深度（≥30 个样本，holdout ≥10，隔日复排）。时长目标【假设】。

### 3.6 样本、排序与校准
- **样本来源**：真实工件优先 → 对真实工件做确定性变异来埋雷 → LLM 合成（标 `synthetic`，单独统计）。
- **防样本内评估**：用来抽规则、调权重的样本（S1.5 和训练批）**不进**报告 τ。holdout 由专家在看到任何契约打分之前排好；**holdout 排序期间关闭即时一致度反馈**，即时反馈只在训练批上显示。
- **埋雷检出率 = 编译器回归测试**：雷是按契约自己的规则造出来的，检出 100% 是构造使然，不能当效度指标。效度的代理是：专家判为"好"的真实样本的误拒率，以及专家在真实边界样本上对 gate 结果的认可率。
- **统计功效**（零假设、无并列时 Kendall τ 的标准误，√(2(2n+5)/(9n(n−1)))，只看数量级）：n=6→0.36，n=10→0.25，n=20→0.16，n=30→0.13。所以：标准档**不做 holdout、不拟合权重**；深度档 holdout ≥10，"已校准"标签的条件是 **bootstrap CI 下界 > 0**，不用 τ 点值阈值【待定 ★3】。
- τ 计算：分档会产生大量并列，现有 `kendallTau` 只接受两个完整排列（τ-a），并列按插入顺序处理（已复现：4 个同分工件，对 abcd 得 τ=1，对 dcba 得 τ=−1）。必须改成基于分数向量的 τ-b（D8）。
- **权重**：v1 只用 elicited 权重；拟合结果只作"冲突提示"（"你的排序显示替代风险比你说的更重要，要调整吗？"），并且只在深度档用交叉验证做。
- 第二评审者 / 隔日复排用作人类上限；结果数据（v1 只支持手动上传一份文件）只作参考信号，不自动改契约。

### 3.7 访谈者自身评测（新增）
- **回放基线**：用现有手写契约（`intel-table-v1.yaml`；本地 `resume-v1` 在另一台机器上，需要时再取）作为隐藏真值，由 LLM 扮演持有真值的"模拟专家"，跑访谈。
- **指标（只建基线，不预设目标值）**：条目召回/精度（与真值对比）、阈值误差、支持率、诱导率、每个条目平均用的问题数、反弹后的有效修正率。
- **局限**：模拟专家和真人行为有差距，只能当回归基线；真人访谈要加人工抽检。prompt 或模型变更时必须重跑。
- **成本/延迟**：调用次数和延迟必须实测并加预算上限，本文不采用未经测量的估算。

---

## 4. 数据接入与量化对账
- **v1 只支持 CSV/xlsx**，导入后先让专家确认表结构（合并单元格、多行表头、汇总行）。
- **画像先脱敏**：Top-K 默认只发频次和类型，不发原值，除非专家逐列放行；可能含 PII 的列（姓名、电话）默认屏蔽。样例行按会话 opt-in，发送前预览。
- **断言 → 确定性 SQL**：LLM 只把自然语言转成 `{metric, filter, groupby, comparator, value, tolerance}` 和列绑定，并生成一句回译给专家看；SQL 由代码生成，**可复现**。
- **DuckDB 锁定**：连接级禁止加载扩展、禁止访问外部文件和网络，只允许预先注册的表（具体配置项尚未在本机验证【假设】）。
- **数据版本**：每次上传生成快照 hash；契约版本、`data_check` 通过率和冲突结论都绑定快照，数据重传后自动标"过期"。

---

## 5. 与 Crucible 引擎对接

### 5.1 接口
- v1 进程内调用，接口按 MCP 签名设计。新增 `register_contract`（返回 `(contract_id, version)`）、`validate_artifact`（只跑 gate）；`score_artifact`、`calibrate` 改为接收 `contract_id + version + ctx`，**不再接收任意 `contract_path`**（现有工具从任意路径读文件，平台化后是一个读取入口风险）。
- 现有 `calibrate_judge`、`ab_compare` 固定使用全局旅行黄金集，并会覆盖全局报告文件，所以"泛化"实际等于重写（D14）。
- Human Gate：v1 单专家自审自批，要明确角色模型（现在默认 `SYSTEM_ACTOR=admin`）；拒绝记录写入会话库，不写仓库里的 `contracts/rejected-proposals/`。

### 5.2 依赖表（Codex 判定 + 我的复核）
"文档判定"指 v0.1 对现状的描述是否准确。

| D | 内容 | Codex 判定 | 我的复核 | 归属 |
|---|---|---|---|---|
| **D0** | schema v2：`metadata{contract_id, version(int), schema_version, status}`；v2 严格模式；旧契约走兼容分支 | 新增 | 同意。已复现 `metadata` 被剥离（intel 契约加载后为 `undefined`） | P1，最先做 |
| D1 | 硬门层，拒绝时给命名原因，不进 judge | ✅ | 同意 | P1 |
| D2 | 工件级 `fields` 校验 | ✅ | 同意（字段名另被 Live Env 语义校验使用） | P1 |
| D3 | 权重生效；v2 去掉 blend，用一组权重 | ✅ | 同意；补一条：没有 judge 维度时 judge 记 0.5（`augmented.ts:53`） | P1 |
| D4 | 未注册项 fail-loud | ✅ | 同意；已复现 judge 维度被丢弃且**无告警** | P1 |
| D5 | 校准卫生 | ✅ | 同意（两个测试文件和 MCP 都会写冻结路径） | P1 |
| D6 | 通用原语编译 + 参数通道 + `unless` | ⚠️ | 同意判为部分。v0.1 的"任何新规则都不生效"说过头了（新 id 的 `code_predicate` 会执行），但在本文范围（禁止 code_predicate）内结论成立。漏列的问题已核实：`threshold` 从未传进沙箱；`makeStalePricing` 被无参调用（`compiler.ts:83`） | P1（M0a 先做一个子集） |
| D7 | 通用 judge：模板 + JSON + 证据 + 刻度归一（并入 D16）；k 次采样 | ⚠️ | 同意。已复现：`"5"` 被解析成 0.05，`"On a scale of 0 to 1, 0.8"` 被解析成 0 | P2，最小版要在面向外部专家之前完成 |
| D8 | 每个契约独立黄金集；τ-b；holdout；CI | ⚠️ | 同意。`region` 写死只是 TS 类型；扩容集（`purpose: calibration/detection`）已经存在但校准没用它，可以复用 | P2（τ-b 提前到 M1） |
| D9 | 契约身份：缓存 key = hash(编译后规范化契约 + 模型 ID + prompt 版本 + ctx 快照 + 工件)；持久化主键 `(contract_id, version)`；审计按它回放 | ❌ | **同意 v0.1 判断错误，且问题更严重**：所有从 YAML 加载的契约共享同一个缓存 key（已复现串分：无硬约束的契约拿到了 hard=3 的缓存结果，直接计算应为 det=0.95）；`contracts` 表以 `version` 为主键并 `INSERT OR REPLACE`，不同契约互相覆盖。补充一点细节：经 `applyContractPatch` 修订的**内存中**契约会被补上 `metadata.version`，所以演化流程里版本号能递增，但不同契约之间照样会撞 | P1 |
| D10 | 证据层：按来源等级推导 trust | ✅ | 同意；先要设计工件按单元格携带来源的方式 | P2 之后，v1 不做 |
| **D11** | 评估上下文 `score(artifact, ctx)`：`as_of`、参考表（快照 hash）、binding 物化 | 新增 | 同意。`REFERENCE_DATE=2026-06-25` 写死在 `freshness.ts:16`、`stale_pricing.ts:15` | P1 先做最小版（as_of + 单张参考表） |
| **D12** | 行级评分：每个 node 的 gate/rubric 结果 | 新增 | 同意列入，但 **v1 不需要**：按条目判断的场景用单 node artifact 解决（§2.1） | v2 |
| **D13** | fail-closed：谓词出错 → `error` 状态并阻止打分；空 rubric、缺 judge → `n/a` | 新增 | 同意。已复现：会抛错的沙箱谓词返回 `[]`，等于 fail-open | P1 |
| **D14** | 校准读取契约的 `golden_set_ref/metric`，报告按契约分开存 | 新增 | 同意（全仓 `frozen_golden_set` 只在 schema 里出现） | P1 |
| **D15** | 契约变更语义：增加改参数/改 enforcement/改例外的操作；patch 后重新做 schema 校验；diff 在 ContractSpec 层做 | 新增 | 同意。补一点：`applyContractPatch` 会**静默重新归一化权重**，专家给的权重可能被悄悄改掉，必须改为报错或经确认 | P1 扩展 |

**fail-loud 语义汇总**（D0/D4/D6/D13）：v2 有未知键 → 加载失败；未知原语或 `type` → 加载失败；参数不符合原语 schema 或引用了不存在的字段 → 加载失败；未注册的 judge 模板 → 编译失败；谓词运行出错或缺参考数据 → 本次评分状态为 `error`，不出分；维度无法评估 → 记 `n/a` 并在报告列出，不默认 1.0/0.5。

---

## 6. 前端 MVP（缩小）
- **最先做、做好样本分档/排序界面**（S1.5 和 S4 共用）：拖进 好/中/差 → 档内两两比较（只比不确定的对）→ 每张卡写一句点评。训练批显示即时 τ-b 和 CI；holdout 批不显示任何分数。
- 三栏：左边会话列表｜中间聊天（冲突卡片内嵌在消息流里）｜右边**只保留"规则｜维度｜样本"三个标签** + 常驻完备度清单。证据要求标签推迟（依赖 D10）。
- 回译确认卡是一等组件：列表里每条条目都显示"系统理解为……"，点击可看原话。
- 发布页：基于 ContractSpec 的 diff（不用 ContractPatch）、"判决变化报告"（固定回归样本里哪些从过变成拒）、导出 YAML + 溯源包。
- M1–M2 阶段用最薄的独立页面，甚至 CLI/notebook 来验证中间层；不嵌入 Live Env。
- **v2 语音**：只用于访谈；ASR 最容易在数字上出错（"十五/五十""两倍/两杯"），所以语音下**所有数值参数都必须在屏幕上用确认卡确认**；溯源锚点加 `audio_ref`。

---

## 7. 技术选型、里程碑、风险、开放问题

### 7.1 技术选型
TypeScript 同仓｜Vercel AI SDK（**当前端点是否支持 JSON schema 结构化输出未验证**，必须保留"解析 + zod + 重试 + 计数"兜底；推理模型不设 temperature）｜SQLite（会话、条目、溯源、版本）｜DuckDB（锁定配置）+ SheetJS｜React。DuckDB 和 better-sqlite3 都是原生依赖，便携打包需要验证。本地模型：`OPENAI_BASE_URL` 已可配置，可以指向本地推理服务，但抽取质量未验证。

### 7.2 里程碑（样本优先；只写验收方式，不预设数值）
| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0a 引擎"可信契约"最小集** | D0、D9、D13、D1、D2、D4、D5、D3、D14；D6 子集（`required/enum_in/range/regex/unique/ratio_threshold/cross_field` + `unless` + 参数通道）；D11 最小版；τ-b | §2.3.2 的示例能加载，每条规则都实际参与评分；未知键、未注册项、谓词异常全部报错；两份契约不串缓存、不串持久化；以上作为 CI 检查 |
| **M1 样本优先闭环（不含访谈）** | CSV 导入 → 专家分档 10–20 个真实工件 + 点评 → 抽取 → 回译确认 → 编译 → 打分 → τ-b + CI | 记录 τ-b 及 CI、条目确认/驳回比、专家耗时，以及**需要 judge 才能表达的点评占比**（决定 D7 的紧迫程度） |
| M2 访谈 + 溯源 + 访谈者评测 | 围绕分歧追问的 Interviewer；三道闸；Verifier；§3.7 回放基线 | 支持率、诱导率、条目召回都有基线数字 |
| M3 通用 judge 最小版 | 模板化、JSON、刻度归一；先测方差再决定 k | judge-only τ 和重复运行方差可以报告 |
| M4 数据对账 | 脱敏画像 + 断言→确定性 SQL + DuckDB 锁定 | 所有查询可复现；无任意文件访问 |
| M5 前端完善 + 外部专家 | 完整界面、发布页、第二个领域 | 同 M1 的记录项 |
| M6 语音 | 视 M5 的耗时数据决定 | — |

从 M1 起，"编译产物在真实引擎上实际执行"就是 CI 检查项（v0.1 写的"引擎延期时中间层先基于 Spec 开发"会掩盖"能加载但不生效"这类问题，已撤回）。

### 7.3 风险（在 v0.1 基础上新增）
| 风险 | 应对 |
|---|---|
| 断章取义/数值无据的引用 | §3.2 三道闸 + 支持率 |
| 双向谄媚、数据锚定 | 先问后亮；诱导率；改口到恰好等于数据值的比例 |
| 样本内评估、反馈污染 | §3.6 隔离 holdout，holdout 期间关闭反馈 |
| 契约漂移影响下游消费者 | 语义化版本 + 弃用策略 + MCP 端固定版本；发布前出判决变化报告 |
| 模型漂移 | 缓存 key 和评分记录都带模型 ID + prompt hash；模型变更触发重校准 |
| 提示注入（工件文本、上传数据） | 输入定界与转义；只有专家发言能作为溯源来源；注入用例纳入回归 |
| 数据安全 | 确定性 SQL；DuckDB 锁定；用 `contract_id` 注册表替代 `contract_path` |
| 隐私与知识产权（原话含商业秘密） | 保留/删除策略；导出时脱敏；契约访问授权；核对第三方 LLM 的数据使用条款 |
| 小样本过度声明 | 界面和 MCP 元数据强制附 n 与 CI；"已校准"标签门槛 |
| 构念效度与 Goodhart | 对外措辞克制；结果信号回流；定期用新的真实样本复测 |
| 编译器/原语库升级导致同一 Spec 编译出不同结果 | 记录 `compiler_version` + `spec_hash`；原语变更配迁移脚本 |
| 成本与延迟 | 抽取异步；冲突分桶；预算上限与计数；实测后再定 k |

### 7.4 开放问题【待定】（★ = 最需要 Zink 先拍板）
1. ★ **引擎范围**：是否同意把 D0、D9、D11 最小版、D13、D14、D6 子集、τ-b 并入 P1，作为 P4 的硬前置（M0a）？以及 v2 是否**取消 0.6/0.4 的 `blend`**，改用一组权重（会改变 v2 契约的分数语义，也牵涉对外"0.6/0.4"的说法；旧契约保持不变）？
2. ★ **v1 范围与首批领域**：是否同意 v1 = `table` 族、artifact 级评分、按条目判断的场景用单 node artifact？首批两个验证领域和专家是谁？（建议第一个由 Zink 本人当专家以降低迭代成本，第二个是外部专家 + 真实本地表格。）
3. ★ **发布与"已校准"口径 + 样本优先顺序**：是否接受 M1 先不做访谈、只验证"分档→契约→τ"？标准档（20 个样本）作为"一致度未确证"发布、不设 holdout；只有深度档（≥30 个样本、holdout ≥10、CI 下界 > 0）才给"已校准"标签——可以吗？
4. 原语库 v1 清单（§2.3.3）够不够？`needs_impl` 由谁实现、多久入库？
5. 新规则默认 `penalty`、按 §3.2 条件升 `gate`，是否同意？
6. 隐私默认策略：脱敏画像 + 样例行 opt-in；是否需要承诺纯本地模型？
7. 招聘等涉及人的场景：加敏感属性 lint 就够，还是 v1 直接排除？
8. 契约归属：v1 是否只限本人使用 + 可导出，平台内分享推迟？
9. 结果信号：v1 是否只支持手动上传一次结果文件？
10. 语音的优先级与供应商偏好（建议看 M5 的耗时数据再定）。
11. Verifier 是否必须用和 Extractor 不同的模型（会增加成本）？
12. v1 是否加入只跑 gate 的 `validate_artifact` MCP 工具（成本低、对次用户有价值），生成期规则注入仍留到 P3？

---

## 附录 A：Codex Top 5 / 必修项 → 本版处理
| Codex 意见 | 处理 | 位置 |
|---|---|---|
| Top1 契约身份/schema 版本，D9 被低估 | 采纳并复现；D0 + D9 重写 | 变更记录、§2.3.1、§2.3.3、§5.2 |
| Top2 评估上下文 + 行级评分 | D11 采纳（P1 最小版）；D12 列入但 v1 用单 node artifact 规避 | §2.1、§2.3.2、§5.2 |
| Top3 规则 fail-loud（primitive 分支、参数、例外、fail-closed、退化默认值） | 全部采纳 | §2.3.2、§2.3.3、§5.2 汇总 |
| Top4 溯源只证明存在 | 三道闸 + Verifier 支持率 | §3.0、§3.2 |
| Top5 MVP 过大、缺访谈者评测 | 样本优先重排 + S1.5 + §3.7 | §2.2、§3.7、§6、§7.2 |
| §2.3 示例 YAML 加载失败/静默失效 | 重写并用草拟 v2 schema 验证；给出 v1 投影和探针结果 | §2.3.2 |
| D1–D10 判定 | 已复核，全部同意 | §5.2 |
| 新增 D0、D11–D15、D16 | 采纳；D16 并入 D7 | §5.2 |
| 发布门槛太弱 | 增加客观门槛 + 过期机制 | §2.2 |
| `stakes` 只问不用 | 明确下游用途 | §2.1 |
| `expert_id` 预留 | 采纳 | §1.3 |
| 完备度（饱和误判、直接问权重、列覆盖、分歧解释） | 采纳 | §3.4 |
| 先问后亮、诱导率 | 采纳 | §3.5 |
| 样本内评估、反馈污染、埋雷同义反复、统计功效 | 采纳；我按公式重算了标准误 | §3.6 |
| LLM 不写 SQL、DuckDB 安全、脱敏、数据版本、只做 CSV/xlsx | 采纳（DuckDB 配置未验证，已标注） | §4 |
| MCP `contract_path`、校准/AB 固定全局黄金集、RBAC、拒绝记录目录 | 采纳 | §5.1 |
| 前端 3 个标签、排序界面先做、语音下数字确认 | 采纳 | §6 |
| 结构化输出未验证、原生依赖打包 | 采纳 | §7.1 |
| 遗漏风险表 | 采纳（成本数字除外，见附录 B） | §7.3 |
| `sessions` 表重名 | 采纳 | §2.1 |

## 附录 B：与 Codex 的分歧/保留
1. **"v1 只允许整份作为评价单元"**：引擎层同意；产品层不同意这种表述。Zink 的场景多是逐条判断（一个 SKU 是否符合预期），如果只说"整份"，容易把这些场景排除在外。v0.2 用"单 node artifact + 评估上下文"覆盖，v1 不需要 D12。
2. **成本估算数字**（"一场访谈 120–200 次调用""校准 360 次"）：没有写进正文。这些是没测过的估算，与本文"不写未测数字"的原则冲突；只采纳"异步、分桶、预算上限、实测"这些措施。
3. **首个领域用 intel-table/resume 回放**：采纳为**访谈者评测的回归基线**（§3.7），但不把它定为首个产品验证领域。intel-table 是 Zink 按引擎能力手写的，维度带工程偏向；resume 轨道在 GEV 机器上、不在 box 上，未核实。首批领域由 Zink 决定（★2）。
4. **judge 的时间点**：Codex 的顺序把通用 judge 放在访谈之后（M3）。我同意 M1 可以只用确定性部分，但 M1 必须记录"需要 judge 才能表达的点评占比"。如果占比高，M3 要提到 M2 之前。这一点属于细化，不算反对。
5. **D9 细节补充**（不是分歧）：经 `applyContractPatch` 修订的内存契约会有 `metadata.version`，所以演化流程里版本号能递增；问题集中在从 YAML 加载的契约，以及不同契约之间的碰撞。
6. **取消 `blend`**：技术上同意 Codex，但它牵涉对外的"0.6/0.4"表述和旧契约的分数，所以列为 ★1 交给 Zink 决定，没有当成已定方案。

## 附录 C：核实记录（只读 + `/tmp/probe-v02` 副本，无 API key）
| 探针 | 结果 |
|---|---|
| v0.1 示例 YAML 原样加载 | 失败：`rubric weights must sum to 1.0` |
| 改权重 = 1.0 后 | 键全部被剥离；0 谓词、0 确定性 rubric；违规行 det=1、judge=0、final=0.6 |
| `loadContract(intel-table-v1.yaml).metadata` | `undefined` |
| 跨契约缓存 | travel 契约（hard=3）之后，"无硬约束"的同契约拿到缓存 hard=3；直接计算 det=0.95 |
| 旧 schema 遇到 `type: primitive` | 拒绝 |
| `parseJudgeScore` | "5"→0.05；"3"→0.03；"On a scale of 0 to 1, 0.8"→0 |
| 会抛错的沙箱谓词 | 返回 `[]` |
| 4 个同分工件的 τ | 对 abcd 为 1，对 dcba 为 −1 |
| v0.2 示例 vs 草拟 v2 schema | 通过；改错键名、权重和 ≠ 1 均被拒 |
| v0.2 示例 vs 当前 schema | 拒绝（boolean、primitive、缺 frozen_golden_set、kendall_tau_b） |
| v1 投影 | 能加载；0/0 编译、3 条告警、违规行 final=0.6 |

源码逐行核实过：`schema.ts`、`validate.ts`、`compiler.ts`、`augmented.ts`、`scorer/types.ts`、`scorer-cache.ts`、`sink.ts`、`001_initial.sql`、`003_users_sessions.sql`、`repositories.ts`、`audit.ts`、`sandbox.ts`、`stale_pricing.ts`、`freshness.ts`、`kendall_tau.ts`、`calibrate.ts`、`golden-set-expanded.ts`、`mcp/tools.ts`、`ab/comparison.ts`、`rbac.ts`、`llm/client.ts`、`contract/patch.ts`、DSL 规范 §2.1/§5.1。**未验证**：真实 LLM 行为、结构化输出支持、DuckDB 锁定配置、GEV 上的 resume 轨道、全量测试是否仍然通过。
