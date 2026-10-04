# 评审意见：《访谈 → 契约 → 评分：Crucible 专家知识层 产品设计文档 v0.1》

> 评审日期：2026-10-04（Asia/Shanghai）｜评审对象：`/home/box/crucible-design/2026-10-04-interview-to-contract-design-v0.1.md`
> 代码基线：`zzhan111/crucible` HEAD `b79292718c35bf40b7fa2d38bd3e3b9a0ac18eda`（只读 checkout `/tmp/crucible-ro`，评审前后 `git status` 均干净）
> 参考：审计 `/home/box/crucible-audit/2026-10-04-verification-layer.md`；Issue #1（`gh issue view` 读取，2026-10-04 09:28 创建，无评论）
> 方法：人工逐行读代码 + 在**独立副本** `/tmp/review-probe` 上跑探针脚本（无 API key）+ Codex CLI `--sandbox read-only` 第二意见（其结论均已由我对照代码复核，见附录）。下文所有 `path:line` 均相对仓库根目录。

---

## 总体结论：**需修改后推进**

产品方向成立，文档本身质量高于平均：边界清楚、主动标注【假设】、把"溯源为硬约束""needs_impl 阻止发布""埋雷不进 τ"这些关键纪律写进了设计。但**引擎对接部分对现状的判断有一处关键事实错误、若干处低估**：`ContractSchema` 根本没有 `metadata` 键，文档标为"引擎读取的兼容核心"的 `metadata`/`blend` 会在加载时被整块剥离——这使 D9 的问题远比"同版本号会撞"严重（实测：任意两份从 YAML 加载的契约对同一工件共享缓存结果）。我把文档 §2.3.2 的示例 YAML 原样喂给引擎：**它因权重和≠1 直接加载失败；修正权重后能加载，但一条明显违规的行得到 det=1.0、final=0.6**——所有扩展字段被静默丢弃，规则被跳过，空 rubric 默认满分。此外还缺少两项文档完全没列的引擎能力（"评分上下文/参考数据注入"和"行级评分"），而 §2.1 的 `unit: 行级`、§2.3.2 的 `ratio_threshold(order_qty/sales_30d)`、`lookup_in_ref` 都依赖它们。MVP 范围偏大、里程碑顺序把最贵的验证放在最后；建议先用"样本优先"的最小闭环验证核心价值假设，再做访谈和对账。

---

## 必须修复的 Top 5

### 1. 契约身份与 schema 版本：`metadata` 被整块剥离，D9 被严重低估
- **问题**：`ContractSchema`（`src/contract/schema.ts:41-51`）只有 `artifact_family/fields/hard_constraints/rubric/calibration` 五个键，且全部 6 处 `z.object` 都是默认 strip 模式（`schema.ts:5,13,19,29,35,41`），无 `.strict()`/`.passthrough()`。因此 `loadContract`（`src/contract/validate.ts:5-9`）之后 `metadata` 不存在 → `augmented.ts:26` 的 `contractVersion` 恒为 `'v1'` → 缓存 key（`src/cache/scorer-cache.ts:66-70`，`sha256("v1:"+artifact)`）对**所有**契约相同；持久化侧 `resolveContractVersion` 恒为 1（`src/persistence/sink.ts:33-43`），`contracts` 表以 `version INTEGER PRIMARY KEY` 为唯一标识（`src/persistence/migrations/001_initial.sql:6-14`）并 `INSERT OR REPLACE`（`src/persistence/repositories.ts:52-56`）→ 不同契约互相覆盖 `yaml_text`；审计回放按版本号取契约（`src/persistence/audit.ts:94`）→ 会取到错的契约。连仓库自带的 `intel-table-v1.yaml` 的 `metadata.version: 1.1` 也被剥离（探针确认）。
- **实测**：travel 契约（3 条硬违规）与"去掉硬约束"的同契约，先后对同一 buggy 工件打分，第二个返回了第一个的缓存结果（hard_violation_count=3，而它根本没有硬约束；不经缓存直接算 det=0.95）。
- **为什么重要**：多会话 = 多契约是本产品的基本形态。这一条不修，"串分""审计不可信""版本 diff 不可信"会同时发生，且全部静默。
- **修复**：新增 D0（并入 P1，先于一切）：`ContractSchema v2` 显式包含 `metadata{contract_id, version, schema_version, status}`；对 v2 契约**未知键报错**（`.strict()`），旧契约走兼容分支；版本号用整数（DSL 规范已规定 `metadata.version` 为 integer，`docs/dsl-standard/crucible-dsl-v1.md:53-54,173`；文档示例的 `version: 0.3` 在持久化层会被 `sink.ts:37-41` 抛错）；缓存 key = hash(编译后契约规范化内容 + 模型/提示版本 + 工件)；持久化主键改为 `(contract_id, version)`，审计按此回放。

### 2. 编译路径缺两块文档没列的地基：评分上下文（参考数据）与行级评分
- **问题**：谓词签名是 `(artifact) => Violation[]`（`src/predicates/types.ts:40`），工件只是 `nodes[]` + 固定形状的 `metadata`（`predicates/types.ts:7-24`）。文档的 `ratio_threshold{numerator: order_qty, denominator: sales_30d}` 需要 `sales_30d`——它在用户的 POS 表里，不在采购单行里；`lookup_in_ref` 需要参考表；`freshness` 需要"评分时点"，而现有 `freshness`/`stale_pricing` 用写死的 `REFERENCE_DATE = 2026-06-25`（`src/rubric/freshness.ts:16`，`src/predicates/stale_pricing.ts:15`）。另外 `ScoreReport` 只有整份工件级分数（`src/scorer/types.ts:14-23`），没有每行分数；而 §2.1 允许 `unit: 行级`、§3.6 说"按行抽样排序"。
- **为什么重要**：不解决，原语库一半（ratio/lookup/aggregate/freshness）只能编出"无法求值"的规则；行级排序的 τ 无从计算。
- **修复**：新增 D11「评估上下文」：`score(artifact, ctx)`，`ctx = {as_of, ref_tables(快照 hash), bindings}`；`data_binding` 由一个**确定性 join 步骤**在评分前把参考数据物化进行（enriched artifact），并把数据快照 hash 写进契约版本与评分记录。新增 D12「单元语义」：v1 明确"被评对象 = 一张表/一份单据（artifact），行 = node"；若坚持行级排序，则需要每 node 的 rubric 分与 gate 结果。建议 v1 先只支持 artifact 级排序。

### 3. 规则的"可执行性"在 schema 层就要 fail-loud，且例外/参数/失败语义必须可执行
- **问题**：(a) 文档让新规则用 `type: declarative` + 新键 `primitive`，旧引擎会剥离 `primitive/params/enforcement` 并因 id 未注册而跳过（`src/contract/compiler.ts:86-92`，仅 warn）。(b) 现有引擎没有任何"契约参数 → 谓词"的通道：`code_predicate.threshold` 在 schema 里有（`schema.ts:23`）但沙箱从不传入（`src/contract/sandbox.ts:49-55,123-125`）；`makeStalePricing(maxAgeDays)` 支持参数但编译器无参调用（`compiler.ts:83`）。(c) `exceptions: ["新品首单","促销备货"]` 是自由文本，编译后不可执行 → gate 会错杀专家明确豁免的情形。(d) 沙箱执行出错返回 `[]`（`sandbox.ts:85-87,113-116`；探针确认抛错的谓词返回空违规），即 **fail-open**——放到 gate 语义下就是"规则坏了 = 全部放行"。(e) 退化默认值：无确定性 rubric 时 `rubricAvg=1.0`（`compiler.ts:132-134`），无 judge 维度时 `judgeOverall=0.5`（`augmented.ts:53`）。
- **为什么重要**：这是"访谈产出写了却不生效"的主要通道，且全部静默。
- **修复**：原语作为 discriminated union 的第三个分支 `type: primitive`（旧引擎直接拒绝而非跳过）；`params` 按原语逐个 zod 定义；`exceptions` 必须编译成条件（`unless: {field, op, value}`），编译不了的例外 → 规则整体标 `needs_impl`；gate 求值异常 → 返回 `error` 状态并阻止打分（fail-closed）；空 rubric / 无 judge 维度时不给默认分而是显式 `n/a` 并重算 blend。

### 4. 溯源"原文精确子串"只证明"原话存在"，不证明"原话支持该条目"
- **问题**：§3.2 的确定性检查挡不住最常见的三种失真：断章取义（取"临期品一律不进"而忽略后面补的例外）、数值无据（参数 `value: 2.0` 不会在原文中逐字出现，原文可能是"两倍左右""一倍多"）、空洞认可（`ai_suggested` 被一句"嗯，可以"认可，认可句不含任何规则内容）。现有仓库里 LLM 结构化输出也没有可复用的强校验：`contractAuthorRevise` 把 LLM 输出直接 `as ContractPatch[]`（`src/agents/contract-author.ts:107-113`），`callLLMJson` 只做 `JSON.parse`（`src/llm/client.ts:82-95,107-134`）。
- **为什么重要**：这是"AI 替专家说话"的主风险，而 100% 原话覆盖率这个指标恰恰会给出虚假的安全感。
- **修复**：三道闸——①子串校验（保留）；②**数值落地**：`params` 中每个数字必须能从引用原话中确定性解析，否则必须经过"确认卡"；③**回译确认卡**：把编译后的原语回译成一句人话（"系统理解为：采购量 ÷ 近30天销量 ≤ 2.0，新品首单除外"），专家点确认，溯源记录的是**卡片快照 hash + 确认动作**，而不是一句"嗯"。另加抽检指标"支持率"（独立 verifier 判断原话→条目是否蕴含，分歧交专家），替代"覆盖率"作为质量指标。

### 5. MVP 范围过大、里程碑顺序把最核心的验证放在最后；且缺"访谈者自身评测"
- **问题**：M0 实际 = P1 全部 + D6 + D9 + D7/D8 可用版；M1–M4 又同时引入 DuckDB、docx/pdf、LLM 写 SQL、变异埋雷、两两比较 UI、bootstrap、两个真实领域。最核心的价值假设——"由专家陈述编译出的契约能否复现专家自己的判断"——直到 M3/M4 才首次被测到。同时，全文没有任何"如何评测 Interviewer/Extractor 本身"的设计（M1 的回放测试是好的开头，但没有指标和对照）。
- **为什么重要**：如果契约复现不了专家排序，前面所有访谈与对账工程都要返工。
- **修复**：改为"样本优先"顺序（见 §7.2 意见）：先做"真实样本分档 + 点评 → 抽取 → 编译 → τ-b"最小闭环，再做访谈，再做对账；同时建立 Interviewer/Extractor 评测基线（模拟专家 + 隐藏真值契约 + 人工抽检），作为 M1 验收项。

---

## 按章节的详细意见

### §1 定位
- 一句话里的"经过校准"在单专家、n≈20 的条件下会被外部用户（次用户经 MCP 调用）理解为质量保证。建议对外措辞改为"已度量与专家判断的一致度（含置信区间）"，"已校准"标签只授予深度档且 holdout 达标的版本。
- §1.3 "v1 单专家"与 Issue #1 的结论有张力：Issue 写的是"专家 = 领域操作者本人 + 一线人员 + 上游/行业人员"。v1 单专家可以接受，但应在数据模型里预留 `expert_id`（每条 quote、每次排序都带），否则 v2 做多专家时溯源与排序无法区分来源。
- 次用户（AI 构建者）需要的是**稳定的契约接口**：版本冻结、弃用策略、变更通知——文档没写，见"遗漏风险"。

### §2.1 Session = Scenario
- `stakes`（犯错代价）槽位填了之后，下游没有任何地方消费它。建议让它真正生效：决定新规则默认 `penalty/gate`、阈值在真实数据上取偏保守还是偏严格、校准报告里突出误拒率还是漏放率。否则这是一个只问不用的问题，会消耗专家耐心。
- `unit` 槽位与引擎能力不匹配（见 Top 5 #2）。建议 v1 只允许"整份"作为评分/排序单元，行作为 node。
- `table` 族唯一支持：同意（理由见 §7.4-1）。
- 命名冲突提醒：仓库里已有 `sessions` 表，但它是认证 token 会话（`src/persistence/migrations/003_users_sessions.sql:22-27`），不是场景会话。新表请用 `scenario_sessions` 之类的名字。

### §2.2 访谈状态机
- 顺序问题：S2 长访谈在 S4 样本排序之前。专家的隐性知识更容易在"评判具体样本"时暴露，而不是在抽象问答里（Issue #1 自己的结论就是"待评对象本身就是第一批样本"，"专家只补只有他知道的并对 AI 稿打分纠错"）。建议插入 **S1.5 快速分档**：S1 读完数据后，先让专家把 8–10 个真实工件分 好/中/差 并各写一句理由，S2 的访谈围绕"你为什么把 A 放在差档"展开。这样问题天然具体、天然带例子，也直接解决 §3.4 的"维度有好例/坏例"检查项。
- 退出条件：S5 的"专家看过一致度报告并接受"是自我认可，作为发布门槛太弱。建议发布至少还需满足客观项：埋雷样本 gate 检出 100%（这其实是编译器正确性测试，见 §3.6）、专家判为"好"的真实样本误拒数=0 或逐条确认、`needs_impl`=0、`open` 冲突=0。
- 回退带问题：好设计。但需要定义"回退会使哪些已确认条目失效"（例如权重改了以后 S5 的 τ 失效、S4 的部分样本需重排），否则状态机会进入"看起来已完成、其实过期"的状态。建议每个条目和每份报告记录其依赖的契约版本，版本变化后自动标"过期"。

### §2.3 契约对象模型
**§2.3 开头的"兼容性事实"**：结论"扩展键不会报错但不会生效"正确，但不完整——剥离发生在**每一层嵌套**（`fields[]`、`hard_constraints[]`、`rubric[]`、`calibration` 里的新键都会被剥离），而不仅是顶层。并且文档说"扩展字段放在新的顶层键下"，但 §2.3.2 的示例实际把大部分扩展字段放在了现有对象内部（`fields[].unit/data_binding`、`hard_constraints[].primitive/params/enforcement`、`rubric[].definition/anchors/judge_spec`），前后矛盾。

**§2.3.2 示例 YAML 与引擎实际解析的逐字段对照**（探针 + Codex 双重确认）：

| YAML 路径 | 引擎实际行为 | 证据 |
|---|---|---|
| `metadata.*`（contract_id/version/status/scenario_id） | **整块剥离**（文档把它标为"引擎读取的兼容核心"——错误） | `schema.ts:41-51` |
| `artifact_family: table` | 接受 | `schema.ts:42` |
| `blend` | **整块剥离**；0.4 写死 | `schema.ts:41`；`augmented.ts:9,57` |
| `fields[].name/type/required` | 接受（只校验定义本身，不校验工件值） | `schema.ts:3-10` |
| `fields[].unit/data_binding/quote_refs` | 剥离 | `schema.ts:5-10` |
| `hard_constraints[].id/type/rule` | 接受 | `schema.ts:13-18` |
| `hard_constraints[].primitive/params/enforcement/exceptions/status/data_check/test_cases/quote_refs` | 全部剥离；随后 id 未注册 → 编译器 warn 并跳过 | `schema.ts:13-18`；`compiler.ts:86-92` |
| `evidence_requirements`、`source_tiers` | 整块剥离 | `schema.ts:41` |
| `rubric[].dim/weight/mode` | 单项接受；**但示例只有一个维度、权重 0.30 → 整份契约因"rubric weights must sum to 1.0"加载失败** | `schema.ts:31,45-49` |
| `rubric[].weight_source/definition/observables/anchors/good_examples/bad_examples/judge_spec` | 剥离；`substitution_risk` 不在 fanout 注册表 → 被丢弃，但其权重仍计入分母 → judge 均分 0 | `schema.ts:29-33`；`src/rubric/fanout.ts:31-34`；`augmented.ts:45-53` |
| `judge_spec.output.score: "1-5"` | 即使将来接线，现有 `parseJudgeScore` 会把 "5" 解析为 0.05、"3" 为 0.03（>1 且 ≤100 时 /100） | `src/rubric/judge-types.ts:15-27` |
| `calibration.frozen_golden_set/metric` | schema 接受，但**没有任何代码读取这两个字段**（校准永远用内置 8 个旅行工件、永远算 Kendall τ；`spearman_rho` 只存在于枚举中） | `schema.ts:35-39`；`src/calibration/calibrate.ts:35-36,58`；全仓 `rg frozen_golden_set` 仅命中 schema |
| `calibration.metric` 想要 τ-b | 枚举里没有 τ-b；若写 `kendall_tau_b` 会被拒 | `schema.ts:37` |
| `calibration.holdout_ratio/outcome_signal` | 剥离 | `schema.ts:35-39` |

探针结果（把示例权重改为 1.0 后）：`compile predicates=0 rubrics=0`；对一行 `order_qty=9999, sales_30d=1` 的明显违规工件，输出 `deterministic_score=1, judge.overall_score=0, final_score=0.6`。

**其他 schema 意见**
- `rubric` 权重必须跨 det+judge 合计为 1（`schema.ts:45-49`），而文档又引入独立的 `blend`。两者语义必须二选一：要么 rubric 权重在各自组内归一、`blend` 决定组间比例；要么取消 `blend`，由 rubric 权重和推导组间比例（审计已指出现状下 intel 契约 judge 名义 20%、实际 40%）。建议后者——专家只需要理解一组权重。
- `source_tiers` 的 trust 推导需要工件**逐格**携带来源（例如 `unit_price_source`），否则 `evidence_requirements.applies_to.field: unit_price` 无从检查。现有 `source_trust` 是每行一个自报数（`src/rubric/source_trust.ts:15-22`）。需要定义工件侧的证据表示，这是 D10 的前置设计。
- `test_cases: {pass: [g_04], fail: [g_19]}` 引用的样本 ID 需要按契约作用域化（`c_7f3a/g_04`），否则跨契约复用时冲突。
- 溯源 sidecar 单独存放：同意。但需要在编译产物里写入 sidecar 的内容 hash，防止 YAML 与 provenance 漂移。
- **原语清单**：对 table 族基本够用，但缺三类专家常说的规则：①条件/例外（`unless`/`when`，用于"新品首单除外"）；②组内比较（"价格高于同类目中位数 30%"——`group_compare`，需要 group_by）；③时间窗（`date_window`，以 `ctx.as_of` 为基准，取代写死的 REFERENCE_DATE）。`freshness` 可视为 `date_window` 的特例。

### §3 中间层（总体）
- 角色划分合理。建议补一个**不参与生成的审查角色**（Verifier）：对 Extractor 的每个条目做"原话→条目"蕴含判断、对 Interviewer 的每个问题做"是否诱导"分类。这是 §3.2 与 §3.5 里"抽检"的落地方式。
- "抽取器负责把规则落到原语"是失真风险最高的一步（概括、补全阈值、合并不同语境的陈述）。建议拆为两步：抽取（只抽"专家说了什么"）→ 编译提议（"这能编成什么原语"），后者的输出必须走回译确认卡（Top 5 #4）。

### §3.1 抽取
- 逐轮增量抽取会产生重复和碎片：同一条规则常分散在多轮（第 3 轮说"太多"，第 7 轮说"两倍吧"）。需要条目合并/实体消解机制，`quote_refs` 允许多段、跨轮。
- LLM 自报的 `confidence` 未经校准，只能用于排序（决定先问什么），不能用于任何门槛。
- 实时抽取不应阻塞 Interviewer 的回复（延迟见"遗漏风险-成本/延迟"）；建议异步，右侧预览稍后刷新。

### §3.2 溯源
见 Top 5 #4。补充两点工程细节：
- `char_span` 要规定基准：基于不可变的原始转写（append-only），修订作为单独的层；明确是 UTF-16 码元还是 Unicode 码点（中文 + emoji 场景两者不同）。子串比较前做规范化（全半角、空白），但存档原文。
- `direct_edit` 作为溯源：同意，但 direct_edit 的条目也要走数值落地和回译确认，否则侧栏编辑就成了绕过溯源的后门。

### §3.3 冲突检测
- "专家 vs 专家"若做全量两两比对，条目数增长后是 O(n²) 次 LLM 调用；应按字段/维度分桶，只在同桶内比。
- "专家 vs 自己的排序"是最有价值的信号，但小样本下单个反例可能是噪声，应作为追问而不是"冲突必须清零"。
- 缺一类："数据 vs 数据"（两张表口径不一致，如 ERP 采购量与 POS 出库对不上）。
- "发布前 open 必须为 0"会诱导专家为了通关大量点"坚持原判"。建议把 `accepted_divergence` 比例作为契约质量指标公开展示。

### §3.4 完备度
- 清单方向正确。问题：①"饱和：最近 3 轮无新条目"会把"专家累了、回答变短"误判为饱和——应结合回答长度/信息量，或改为"最近 N 个针对性问题均被回答且无新条目"。②"权重已问"——直接问权重的信度很差，专家常说"都重要"；更可靠的是从取舍题和排序中推断，再请专家确认（与 §7.4-6 一致）。③缺"数据列覆盖"：每个数据列要么已绑定、要么专家明确说无关。④缺"分歧样本已解释"：S5 分歧最大的 3 对是否都有了解释。⑤"区分度"检查非常好，建议保留为硬项。
- 完备 ≠ 正确。清单达标只说明"结构完整"，不应在 UI 上暗示"契约正确"。

### §3.5 反弹策略
- 触发器表很实用。主要风险是**双向谄媚**：LLM 顺着专家（不追问）或为完成清单反复纠缠；以及专家顺着 AI（权威偏差）。"每条最多 2 轮"和"每轮一个反弹点"是对的。
- "数据冲突"卡片会造成**锚定**：先亮出"数据是 1.2 倍"，专家很可能直接改口到 1.2，即使数据口径有问题。建议"先问后亮"：先问"你这个'一倍'是怎么得出来的、指哪段时间哪些品"，再亮数据。
- "禁止诱导"不能只靠 prompt。需要对 Interviewer 每个问题做自动分类（是否是"是不是应该 X？"式封闭诱导），记录诱导率并作为回归指标。
- "影响 × 不确定性"排序：作为启发式可以，但要先定义"不确定性"的可计算代理（如缺阈值、缺例子、存在冲突），否则无法测试。

### §3.6 样本、排序与校准
- **评估循环性（最重要）**：规则是从专家对样本的点评中抽出来的，再在同一批样本上算 τ——这是样本内评估，τ 必然偏高。必须保证：用于抽规则/调权重的样本不进入报告用的 τ；holdout 样本在**看到任何契约打分之前**由专家排好。
- **即时一致度反馈会污染后续排序**：专家看到"契约给 B 更高分"后，下一批排序会向契约靠拢。即时反馈只能在训练批上显示，holdout 排序期间禁用。
- **埋雷检出率是同义反复**：雷是按契约自己的规则确定性变异出来的，检出率≈100% 是构造使然，它测的是"编译器是否正确实现了规则"，不是"规则是否有效"。作为回归测试保留，但不要在一致度报告里当作效度指标。效度的代理应是：专家判为"好"的真实样本的误拒率、专家对 gate 结果在真实边界样本上的认可率。
- **样本量与统计功效**：零假设下 Kendall τ 标准误 ≈ √(2(2n+5)/(9n(n−1)))：n=10 → 0.25，n=20 → 0.16，n=30 → 0.13；若标准档 20 个样本按 30% 做 holdout，holdout 只有 6 个，标准误 ≈ 0.36，几乎没有信息量。结论：标准档的 holdout τ 不应作为发布门槛（见 §7.4-5）；拟合权重在 14 个训练样本上 × 5–8 个维度必然过拟合，v1 不建议做 `fitted`。
- 现有引擎的 τ 实现无法直接复用：`kendallTau` 只接受两个完整排列，按逆序对计算 τ-a（`src/calibration/kendall_tau.ts:27-65`，注释写 τ-b 但不处理并列，`kendall_tau.ts:11`）；`rankingFromScores` 遇并列按插入顺序（`kendall_tau.ts:73-77`）——探针：4 个全同分工件，对 [a,b,c,d] 得 τ=1，对 [d,c,b,a] 得 τ=−1。分档排序产生大量并列，必须改为基于分数向量的 τ-b。
- 已有可复用资产：`src/fixtures/golden-set-expanded.ts:23-41` 已有 `purpose: 'calibration' | 'detection'` 与违规模式标注，`region` 是 `string`——这正是"埋雷样本不进 τ"的数据模型雏形，但 `runJudgeCalibration` 没用它（只用 `getGoldenArtifacts()` 的 8 个旅行工件，`src/calibration/golden_set.ts:14-21`）。

### §4 数据接入与量化对账
- **LLM 写 SQL 不是必须的**：文档已经把断言结构化为 `{metric, filter, groupby, comparator, value, tolerance}`，这个结构可以由**确定性代码**编译成 SQL。LLM 只负责"自然语言 → 断言 + 列绑定"，再给专家看一句回译。这样"所有查询可复现"（M2 验收）才真正成立，也消除了 SQL 语义错误导致的伪冲突/伪一致。
- **DuckDB 安全**：DuckDB 可以通过 `read_csv('/任意路径')` 等函数读取本机任意文件、可加载扩展访问网络。若执行 LLM 生成的 SQL，"只读"不够，必须在连接级关闭外部访问（禁止扩展与文件系统函数，只允许预先注册的表）。在平台化/多用户部署下这是数据外泄通道。（DuckDB 具体配置项未在本机验证，见附录。）
- **隐私**："只发画像"并不等于不泄露：Top-K 值、异常值、列名本身就可能含顾客姓名、供应商名、价格。画像需要 PII/敏感值脱敏（例如 Top-K 只发频次与类型，不发原值，除非专家逐列放行）。
- **数据版本**：用户重新上传数据后，`data_check.pass_rate`、冲突结论都会过期。契约版本应记录所依据的数据快照 hash。
- v1 只做 CSV/xlsx；docx/pdf 证据检索推迟（它服务的是 D10 证据层，而 D10 本身是 P2）。
- xlsx 实际文件常有合并单元格、多行表头、汇总行——画像前需要"表结构确认"步骤（让专家确认表头和数据区域）。

### §5 与 Crucible 引擎对接
- §5.1 接口：现有 MCP 工具是 `score_artifact / run_workflow / calibrate_judge / evolve_contract / ab_compare`（`src/mcp/tools.ts:173-179`），没有 `register_contract`、`validate_artifact`；`score_artifact` 接受的是 `contract_path`（任意文件系统路径）而非 `contract_id`（`tools.ts:36-54`），每次调用都重新加载编译。`calibrate_judge` "泛化"实际上是重写：它忽略契约的黄金集配置、永远用旅行黄金集，且每次都覆盖全局 `golden/calibration-report.json`（`tools.ts:119-124`，`calibrate.ts:89-92`）。`ab_compare` 同样硬接全局黄金集与全局人类排序（`src/ab/comparison.ts:49-54`）。
- 平台化时 `contract_path` 是任意路径读取入口，必须替换为 `contract_id` + 注册表。
- §5.2 依赖表本身基本准确（逐项见下节），但**遗漏**了以下引擎项，建议补入：
  - **D0** schema v2 + metadata/contract_id/schema_version + 未知键报错（Top 5 #1）
  - **D11** 评估上下文：参考表、`as_of`、`data_binding` 物化（Top 5 #2）
  - **D12** 评分单元语义 / 行级结果（Top 5 #2）
  - **D13** 谓词失败 fail-closed；空 rubric/无 judge 的退化默认值修正（`sandbox.ts:85-87,113-116`；`compiler.ts:132-134`；`augmented.ts:53`）
  - **D14** 校准模块真正读取契约配置（`frozen_golden_set`/`metric`），报告按契约存储（`calibrate.ts:35-36`；`golden_set.ts:55-57`）
  - **D15** 契约变更语义：`ContractPatch` 只有增删字段/约束/维度与调权重（`src/contract/patch.ts:8-15`），没有"修改约束参数/enforcement/例外"操作；`applyContractPatch` 不重新做 schema 校验（`patch.ts:69-90`）。§6.1 "发布页复用 ContractPatch 做版本 diff"不够用——diff 应在 ContractSpec 层做。
  - **D16** Judge 输出刻度：1–5 分制与 `parseJudgeScore` 不兼容（`judge-types.ts:15-27`）——并入 D7。

### §6 前端 MVP
- 右侧 6 个标签页对 v1 偏重。建议 v1 只保留"规则｜维度｜样本"三个标签 + 常驻完备度清单；"证据要求"依赖 D10（P2），"冲突"可以内嵌在聊天流里。
- 样本排序界面是 v1 的核心资产，应最先做、做好（理由见 §7.2 意见）。
- 发布页的 RBAC：`processGateDecision` 要求 `approve:contract` 权限（`src/agents/human-gate.ts:73`），reject 会写入仓库目录 `contracts/rejected-proposals/`（`human-gate.ts:11,83-95`）。单专家自审自批需要显式定义角色，拒绝记录应写会话库而不是仓库目录。
- §6.2 语音：补充一点——ASR 对数字最容易出错（"两倍/两杯""十五/五十"），而数字恰好是阈值。语音下所有数值参数必须在屏幕上确认。

### §7.1 技术选型
- "Vercel AI SDK 结构化输出 + zod"：仓库目前只用 `generateText` + 手动 `JSON.parse`（`client.ts:59-62,122-129`），没有使用 schema 约束的结构化输出；审计记录的实际端点是 OpenAI 兼容的推理模型，且代码注释说明为兼容推理模型刻意不设 temperature（`client.ts:57-58`）。该端点是否支持 JSON schema/工具调用式结构化输出**未验证**。务必保留"解析 + zod 校验 + 重试 + 计数失败"的兜底路径（Live Env 事件源已有 zod 校验 + 回落的样板：`src/env/event-source/llm.ts:102-110`）。
- DuckDB 的 Node 绑定和 better-sqlite3 都是原生依赖，打包/便携（仓库有 `scripts/pack-portable.sh`）需要验证。
- TypeScript 同仓：同意。

### §7.2 里程碑
**范围判断：偏大**（M0 ≈ P1 全部 + D6 + D9 + D7/D8；M2 引入 LLM-SQL 与多格式解析；M4 要求两个领域真实专家走完全流程）。同时在三处**偏小**：没有 Interviewer/Extractor 评测基线、没有契约回归测试、没有 SQL/数据安全工作项。

**顺序问题**：最贵的验证（契约能否复现专家判断）在 M3/M4 才出现；M1 与 M2 可并行的说法成立，但 M2（对账）对核心价值假设贡献最小，却工作量很大。

**建议顺序**：
| 新里程碑 | 内容 | 验收 |
|---|---|---|
| M0a 引擎"可信契约"最小集 | D0、D9、D1、D2、D4、D5、D13、D3；D6 只做 `required/enum_in/range/regex/unique/ratio_threshold/cross_field` + `unless` + 参数通道；D11 只做 `as_of` + 单张参考表 | 文档示例 YAML 能加载且每条规则都参与评分；未知键/未注册项/谓词异常全部报错；两份契约不串缓存、不串持久化 |
| M1 样本优先闭环（无访谈） | CSV 导入 → 专家对 10–20 个真实工件分档 + 一句点评 → 抽取（点评→候选条目）→ 回译确认 → 编译 → 打分 → τ-b + CI（D8 最小版） | 记录：契约 vs 专家 τ-b 及 CI、条目确认/驳回比、专家耗时 |
| M2 访谈 + 溯源 | 围绕 M1 分歧追问的 Interviewer；溯源三道闸；Interviewer/Extractor 评测基线（回放 intel-table 与模拟专家） | 支持率、诱导率、条目召回（对回放真值）均有基线数字 |
| M3 通用 judge（D7 最小版） | 模板化 judge、JSON 输出、刻度归一、重复采样方差测量 | judge 维度重复运行方差可报告；judge-only τ 单独报告 |
| M4 数据对账 | 画像 + 断言→确定性 SQL；LLM 只做映射 | 所有查询可复现；无任意文件访问 |
| M5 前端完善 + 第二领域 | 完整三栏、发布页、第二位外部专家 | 同文档原 M4 的记录项 |
| M6 语音 | — | — |

### §7.3 风险
现有表格覆盖了主要产品风险，但缺技术/效度/安全类风险，见"遗漏风险"。另外，"引擎依赖延期 → M1/M2 可先基于 ContractSpec 开发"这条应对有隐患：不接引擎就无法发现编译结果"能加载但不生效"这一类问题（正是本次探针暴露的问题）。建议 M1 起就把"编译产物在真实引擎上实际执行"作为 CI 检查。

---

## D1–D10 对照表

判定口径："判定"评价的是**文档对现状的描述是否准确**（✅ 准确 / ⚠️ 部分准确或低估 / ❌ 关键事实有误）；"实际代码状态"给出所需能力是否存在。

| D | 文档说法 | 实际代码状态 | 证据 path:line | 判定 |
|---|---|---|---|---|
| D1 硬门层 | 每条 hard 违规只扣 0.15，违规工件照常打分 | **不存在**。准确地说是确定性分的乘性因子 `max(0,1−0.15×n)×rubricAvg`，judge 照常调用；`ScoreReport` 无 rejected 状态；无 `src/gate/` 目录。补充：沙箱谓词异常返回 `[]`（fail-open），做 gate 时必须改 | `src/contract/compiler.ts:23,135-136`；`src/scorer/augmented.ts:39-42`；`src/scorer/types.ts:14-23`；`src/contract/sandbox.ts:85-87,113-116` | ✅ |
| D2 fields 校验 | 只用于展示，评分时不校验 | **不存在**工件级 type/required/enum 校验。小修正：`fields` 名称还被 Live Env 语义校验使用 | `compiler.ts:55-149`（无 fields 引用）；`src/env/semantic-validator.ts:46-48` | ✅ |
| D3 权重生效 + blend | 确定性维度等权；0.6/0.4 写死 | **部分存在**：judge 组内权重生效；确定性等权；blend 写死。遗漏：无 judge 维度时 judge=0.5（final=0.6·det+0.2）；无确定性 rubric 时 rubricAvg=1.0；rubric 权重跨组和=1 与 blend 语义冲突 | `compiler.ts:132-134`；`augmented.ts:9,45-57`；`src/contract/schema.ts:45-49` | ✅ |
| D4 未注册 fail-loud | compiler 告警后跳过；fanout 静默丢弃且分母仍计权重 | **不存在** fail-loud；compiler 有 warnings（不抛错），fanout 无任何告警；权重留在分母。financial `tax_compliance` 未注册 → judge=0 | `compiler.ts:86-92,109-115`；`src/rubric/fanout.ts:22-36`；`augmented.ts:45-53`；`contracts/financial-v1.yaml:150` | ✅ |
| D5 校准卫生 | `npm test` 会覆盖冻结报告 | **不存在**。两个测试文件写冻结路径（且是去掉 API key 的降级结果）；MCP `calibrate_judge` 也写同一路径；无全同分拒存；报告只有 final τ 与 per-judge-dim τ | `tests/qa/p1-acceptance.test.ts:77-78`；`tests/calibration/calibrate.test.ts:19-21,64-66`；`src/calibration/calibrate.ts:89-92`；`src/calibration/golden_set.ts:55-57`；`src/mcp/tools.ts:122-123` | ✅ |
| D6 通用原语编译 | `switch(c.id)` 硬编码，新 id 被跳过，"任何新规则都不生效" | **不存在**通用声明式原语。"任何新规则"说法过头：`code_predicate` 新 id 会执行 `impl`（但文档已禁止 LLM 生成 code_predicate，故在文档范围内结论成立）。**遗漏**：无契约参数→谓词通道（`threshold` 未传入沙箱；`makeStalePricing` 无参调用）；`REFERENCE_DATE` 写死；ratio/lookup 需要的参考数据通道不存在（见 D11） | `compiler.ts:58-63,64-93,83`；`sandbox.ts:49-55,123-125`；`schema.ts:23`；`src/predicates/stale_pricing.ts:15-18`；`src/rubric/freshness.ts:16`；`src/predicates/types.ts:40` | ⚠️ |
| D7 通用 judge | 每维一个手写文件；取第一个数字，失败回落 0.5 | **部分存在**：手写 judge 与第一个数字解析均属实；`callLLMJson`（JSON 解析，无 schema 约束）已存在可复用；无契约驱动 judge、无证据引用、无多次采样。**遗漏**：1–5 刻度会被解析成 0.01–0.05；`strategic_insight` 无 key 时走结构启发式 mock | `fanout.ts:31-34`；`src/rubric/judge-types.ts:15-27`；`src/rubric/dining_fit.judge.ts:6-11`；`src/llm/client.ts:107-134`；`src/rubric/strategic_insight.judge.ts:31-39` | ⚠️ |
| D8 黄金集泛化 | 全局 8 样本、单人排序、τ-a 不处理并列；`region` 写死 | **部分存在**：现行校准路径确为 8 个固定工件 + 单一排序 + τ-a。但扩容集（calibration/detection 用途标注、`region: string`、含 table/financial）已存在而未被校准使用；`region` 写死只是 TS 类型。**遗漏**：校准完全不读契约的 `frozen_golden_set`/`metric`，对 table 契约也会拿旅行工件打分 | `src/calibration/golden_set.ts:14-34`；`src/calibration/types.ts:12`；`src/calibration/kendall_tau.ts:11,27-65,73-77`；`src/fixtures/golden-set-expanded.ts:23-41,328-337`；`calibrate.ts:35-36` | ⚠️ |
| D9 契约身份 | 缓存 key = hash(工件+version)，不同契约同版本号会撞 | **不存在**，且现状比文档描述严重得多：`ContractSchema` 无 `metadata` → 加载即剥离 → version 恒为 `'v1'`，**所有** YAML 加载的契约共享缓存 key（探针实测串分）；持久化恒为版本 1、`INSERT OR REPLACE` 互相覆盖；审计按版本号回放契约。文档 §2.3.2 把 `metadata` 标为"引擎读取"——错误 | `src/contract/schema.ts:41-51`；`src/contract/validate.ts:5-9`；`augmented.ts:26,32`；`src/cache/scorer-cache.ts:66-70`；`src/persistence/sink.ts:33-43`；`src/persistence/migrations/001_initial.sql:6-14`；`src/persistence/repositories.ts:52-56`；`src/persistence/audit.ts:94` | ❌ |
| D10 证据层 | trust 来自工件自报 | **不存在**分级推导；`sourceTrust` 平均节点自报值；`source_trust_floor` 也读自报值且阈值写死 | `src/rubric/source_trust.ts:15-22`；`src/predicates/source_trust_floor.ts:15-16` | ✅ |

**汇总**：✅ 准确 6 项（D1、D2、D3、D4、D5、D10）｜⚠️ 部分准确/低估 3 项（D6、D7、D8）｜❌ 关键事实有误 1 项（D9）。另有 6 项文档未列的必需引擎能力（D0、D11–D15，见 §5 意见）。

---

## §7.4 开放问题意见

1. **v1 只支持 table？brief 何时？** —— 同意 v1 只做 table，并进一步限定"被评对象 = 一张表/一份单据，行 = node，排序单元 = 整份"。brief 本质上几乎全靠 judge，而 judge 是当前效度最弱的一环；建议在通用 judge（D7）完成并在 table 场景里测出 judge-only τ 与重复方差之后再开 brief，即 v2 之后。
2. **原语够不够？是否允许 code_predicate？** —— 补 `unless/when`（例外）、`group_compare`（组内比较）、`date_window`（以 `ctx.as_of` 为基准）三类，其余够 v1。即使 isolated-vm 就位，v1 也不应让专家/LLM 写 `code_predicate`：问题不只是沙箱隔离，而是专家无法审读代码、无法溯源、无法回译确认。表达不了的规则走 `needs_impl` 队列，由工程师实现为新原语、经评审入库——这同时是原语库的需求来源。
3. **新规则默认 penalty 还是 gate？** —— 默认 `penalty`。升级为 `gate` 需同时满足：专家在回译确认卡上明确选择"直接不合格"，且在真实数据试跑中，专家判为"好"的样本被拒数为 0（或逐条确认）。`stakes` 槽位可以决定提示语气（"缺货更贵"时提示 gate 慎用），但不自动决定。
4. **数据隐私默认策略？本地模型？** —— 默认只发脱敏后的画像与聚合结果（Top-K 原值默认不发，逐列放行）；样例行按会话 opt-in，并在发送前预览实际要发的内容。纯本地模型：v1 不作为产品承诺，但成本几乎为零——`callLLM` 已支持可配置的 OpenAI 兼容 `baseURL`（`src/llm/client.ts:50-53`），可指向本地推理服务；需要验证本地模型的抽取质量（未验证）。
5. **样本数量 10/20/30+ 是否合理？是否强制 holdout？** —— 分档数字可以保留，但含义要改：快速 10 = 草稿（同意不可发布）；标准 20 = 可发布，但标注"一致度未确证"，**不做权重拟合、不强制 holdout**（20×30% = 6 个 holdout 时 τ 标准误≈0.36，强制它只会制造噪声数字）；深度 30+ 且 holdout ≥ 10 个（标准误≈0.25 以内）才授予"已校准"标签，且发布条件用 bootstrap CI 下界 > 0，而不是 τ 点值阈值。
6. **权重以专家取舍为准，还是允许拟合覆盖？** —— elicited 永远是默认且不被自动覆盖。拟合结果只作为"冲突提示"出现（"你的排序显示'替代风险'比你说的更重要，要调整吗？"），由专家决定；拟合只在深度档、交叉验证下做。
7. **D6、D9 并入 P1？通用 judge 在 P4 前完成？** —— 是，并且 P1 还应纳入 D0（schema v2/metadata）、D13（fail-closed 与退化默认值）、D11 的最小版（`as_of` + 单张参考表）、D14（校准读取契约配置）。通用 judge 需要在面向外部专家的里程碑之前完成最小版（模板化 + JSON + 刻度归一），因为几乎每个专家场景都会有至少一个判断维度（如示例里的 `substitution_risk`）；k=3 采样可以后置，先测方差再决定。
8. **首批两个验证领域？** —— 第一个选 Zink 本人能当专家、且已有手写契约可回放的领域（intel-table 或本地 resume 轨道），迭代成本最低；第二个选外部专家 + 真实本地表格数据的领域（如采购单或门店 SKU），以检验"领域无关"。具体谁当专家需要 Zink 决定；注意 Issue #1 中便利店例子里的现有数据缺品类与销量，作为首个外部领域数据可能不够。
9. **契约归属与共享？** —— v1 仅本人可用 + 可导出（YAML + 溯源包）。平台内分享推迟：溯源包含专家原话（可能含商业秘密与第三方信息），分享前需要脱敏和授权机制。
10. **结果信号接入方式？v1 做不做？** —— v1 不做直连；最多支持手动上传一份结果文件做一次性离线对比。直连 ERP/POS 涉及凭据、合规与混杂因素处理，回报不确定。
11. **语音优先级与供应商？** —— 低优先级，取决于 M5 的专家耗时数据（如果文本访谈的主要瓶颈是打字，再做语音）。此问题我没有足够依据给出供应商建议。
12. **独立 Web 应用还是嵌入 Live Env 页面？** —— M1–M2 期间用最薄的独立页面（甚至 CLI/notebook）验证中间层，不建议嵌入 Live Env：Live Env 是面向事件流评分演示设计的（HTTP/SSE），会话状态机、排序拖拽、溯源高亮都需要另建。（我未深入审读 `src/env/http.ts` 的前端结构，此判断基于其定位。）
13. **v1 是否导出"生成期规则"（P3）？** —— v1 只评分。但 gate 落地后，以 MCP 暴露一个只跑 gate 的 `validate_artifact` 成本很低、对次用户价值高，可以作为 v1.1 加入；把规则注入生成方 prompt 的"生成期规则"推迟到 P3。

---

## 遗漏风险

| 风险 | 说明 | 建议应对 |
|---|---|---|
| **LLM 伪造/断章取义的引用** | 子串校验挡不住"真原话、错语境"和"数值无据" | Top 5 #4 的三道闸 + 支持率抽检 |
| **访谈者自身无评测** | 无法知道 Interviewer 是否在诱导、遗漏、纠缠；改 prompt 后无回归 | 模拟专家（LLM 扮演，持有隐藏真值契约）+ 回放真实访谈；指标：条目召回、阈值误差、诱导率、问题数/轮数；加人工抽检。注意模拟专家与真人行为有差距，只作回归基线 |
| **双向谄媚与锚定** | LLM 顺从专家 / 专家顺从 AI；数据卡片锚定专家改口 | "先问后亮"；诱导率监控；`accepted_divergence` 与"专家改口到数据值"比例作为指标 |
| **跨会话/跨版本的契约漂移** | 再次访谈或补数据后规则悄悄变化，已发布的消费者不知情 | 每次发布前在固定回归样本集上重跑，生成"判决变化报告"（哪些样本从过→拒）；语义化版本 + 弃用策略 + MCP 端版本固定 |
| **模型漂移** | 供应商升级模型导致 judge 分数分布变化；现缓存 key 不含模型标识 | 评分记录与缓存 key 写入模型 ID + prompt hash；模型变更触发重校准 |
| **评分效度（构念效度、Goodhart）** | 契约测的是"与单一专家陈述的一致度"，不等于质量；生成方 agent 针对契约优化后会钻规则空子 | 对外措辞克制；结果信号回流作为外部效度；定期用新的真实样本复测 |
| **提示注入** | 被评工件文本直接拼进 judge prompt（如 `dining_fit.judge.ts:6-9`）；用户上传的数据/文档单元格也会进入 Interviewer/Extractor 上下文，可能"植入"规则 | 输入定界与转义；注入用例纳入回归；Extractor 只接受专家发言轮次作为溯源来源 |
| **数据安全** | DuckDB 执行 LLM SQL 可读本机任意文件；MCP `score_artifact` 接受任意 `contract_path`（`tools.ts:42-49`） | 断言→确定性 SQL；DuckDB 关闭外部访问；契约改为按 ID 注册 |
| **隐私与知识产权** | 转写含商业秘密；溯源包导出原话；经 MCP 暴露契约等于暴露专家隐性知识 | 保留/删除策略；导出脱敏；契约访问授权；第三方 LLM 的数据使用条款 |
| **成本与延迟** | 粗估（未实测）：一场 40 轮访谈 × 每轮（Interviewer + Extractor + 冲突检查 + 偶发 SQL）≈ 120–200 次调用；校准一轮 30 样本 × 4 judge 维 × k=3 ≈ 360 次调用。推理模型单次可能 10s 以上，逐轮同步抽取会拖垮聊天体验 | 抽取异步；冲突检查分桶；预算上限与计数；先测方差再决定 k |
| **契约版本与可复现性** | 原语库/编译器升级后，同一 ContractSpec 编译出不同 YAML | 编译产物写入编译器版本与 ContractSpec hash；原语库变更需迁移脚本 |
| **小样本过度声明** | n≈20 的 τ 被当作质量保证传播 | UI 与 MCP 元数据强制附 CI 与样本数；"已校准"标签门槛见 §7.4-5 |
| **公平性/合规** | 文档把招聘列为示例；专家规则可能编码受保护属性（年龄、性别、籍贯） | 招聘类场景加入敏感属性 lint；或 v1 明确排除招聘场景 |
| **会话中断与恢复** | 专家半途离开，状态机、未确认条目、过期报告如何恢复 | 每个条目/报告绑定契约版本，恢复时显示"上次停在哪、哪些已过期" |
| **单用户自审自批** | 现有 Human Gate 要求 `approve:contract` 权限（`human-gate.ts:73`），默认 system admin（`src/auth/rbac.ts:51`） | 明确 v1 的角色模型；发布动作留审计记录 |

---

## 附：验证方法 / 未能验证的部分

**做了什么**
- 人工阅读：`src/contract/*`、`src/scorer/*`、`src/rubric/fanout.ts`、`judge-types.ts`、`dining_fit.judge.ts`、`strategic_insight.judge.ts`、`source_trust.ts`、`freshness.ts`、`src/calibration/*`、`src/cache/*`、`src/llm/client.ts`、`src/mcp/tools.ts`、`src/persistence/{sink,repositories,audit}.ts` 与 migrations 001–003、`src/agents/{human-gate,contract-author}.ts`、`src/predicates/{types,stale_pricing,source_trust_floor}.ts`、`src/fixtures/golden-set-expanded.ts`、三份契约 YAML、`docs/dsl-standard/crucible-dsl-v1.md` 相关段落、两个写校准报告的测试文件。
- 探针：把仓库（不含 .git）复制到 `/tmp/review-probe`，`node_modules` 链接到审计时已安装的 `/tmp/crucible-test/node_modules`（zod 3.25.76），在**未设置 OPENAI_API_KEY** 的环境下用 tsx 运行一次性脚本，验证了：①`loadContract(intel-table-v1.yaml)` 后无 `metadata`，`resolveContractVersion`=1；②文档 §2.3.2 示例 YAML（第 93–155 行原文）因权重和报错，修正后所有扩展字段被剥离、0 谓词 0 确定性 rubric、明显违规行 final=0.6；③跨契约缓存串分；④沙箱谓词抛错返回 `[]`；⑤全同分时 τ 由插入顺序决定（±1）；⑥黄金集 region 列表。全部写入只发生在 `/tmp/review-probe`；`/tmp/crucible-ro` 评审结束时 `git status` 仍干净。
- Codex CLI 0.155.1：`codex exec --sandbox read-only --ephemeral -C /tmp/crucible-ro`，独立核对 D1–D10 与 YAML 字段。其新增结论（D6 中 code_predicate 可执行新 id、1–5 刻度解析问题、无 judge 维度时 0.5、校准不读契约配置、`callLLMJson` 已存在、审计按版本回放、扩容黄金集已存在）我都逐一打开对应行确认后才采用。Codex 输出存于 `/tmp/codex-dverify-out.md`。
- Issue #1：`gh issue view 1 -R zzhan111/crucible`（`--comments` 因 GitHub classic Projects 弃用报错，改用 `--json` 成功读取；无评论）。

**未能验证 / 需谨慎看待**
- 未调用任何真实 LLM：judge 的真实打分行为、配置端点是否支持 schema 约束的结构化输出、推理模型延迟，均未实测；文中成本/延迟数字是粗估。
- 未重新运行全量测试（审计记录为 79 文件 / 602 测试通过，我没有复现）。
- DuckDB 的外部文件访问/扩展加载行为与关闭方式是基于对 DuckDB 的一般了解，未在本机安装验证。
- 本地简历轨道（`resume-v1.yaml`、R01–R11）在 GEV 机器上、不在 box 上，未读取；涉及它的判断引自审计。
- `xinjiang-travel` 分支未检查；结论只针对 main@b792927。
- 未深入审读 Live Env 前端（`src/env/http.ts`）是否适合承载聊天原型，§7.4-12 的意见基于其定位。
- Kendall τ 标准误使用的是无并列的零假设公式，分档并列时实际值会不同，仅作数量级参考。
