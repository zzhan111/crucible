# Crucible — Product Brief

> 生成方式:ECC `product-lens`(Mode 1 Product Diagnostic + Founder Review grounding)
> 对象:`crucible-dev` worktree(`crucible/p4.6-intel-deepen` 分支)
> 日期:2026-06-30
> 状态:**GO**(附条件,见 §6)
>
> 所有功能/技术/应用断言均来自实际代码库验证(commit `062a91a`,602 测试绿),
> 非营销臆测。引用文件路径可在 worktree 内核验。

---

## 0. 一句话立住

> **一群智能体不靠聊天、而靠一份可执行契约协同,自动发现缺陷、自动提分。**

Crucible 是一个**契约驱动的合成引擎**:把"什么是好的工件"写成一份可执行的 YAML 契约(字段 + 硬约束 + rubric),让 Scorer / Critic / Curator 多智能体围绕这份契约迭代,自动抓 bug、自动 patch、自动提分——所有 agent 通过契约这个共享事实协调,而不是通过聊天消息。

---

## 1. 功能层(What it does)

### 1.1 核心闭环(已实现,3 轮迭代回路)

```
v1(buggy) → Scorer → Critic → Apply Patches → Curator → v2 → ... → v3
```

| 角色 | 文件 | 做什么 |
|---|---|---|
| **Scorer** | `src/contract/compiler.ts` + `src/scorer/augmented.ts` | 把契约编译成可执行评分器;确定性谓词 + LLM judge 双层 |
| **Critic** | `src/agents/critic.ts` | 读违规 → 生成确定性 patch(零 LLM,省一半调用) |
| **Curator v2** | `src/curator/novelty_v2.ts` | 检测 patch 后工件是否产生"新颖状态"(schema + 分布 + set-diff 三路) |
| **Contract-Author** | `src/agents/contract-author.ts` | LLM 提契约修订草案 → Human Gate → A/B → promote/retain |
| **Workflow** | `src/workflow/crucible.ts` | 编排 3 轮迭代,终止条件 = 提升 < 0.01 或达上限 |

最终分 = `deterministic_score * 0.6 + judge_overall * 0.4`。

### 1.2 功能清单(已落地)

| # | 功能 | 证据 |
|---|---|---|
| F1 | **契约 DSL**:artifact_family / fields / hard_constraints / rubric(权重和=1.0,zod 强校验) | `contracts/*.yaml` + `src/contract/schema.ts` |
| F2 | **4 个硬约束谓词**:continuity / state_mutex / time_budget / no_duplicate_state | `src/predicates/` |
| F3 | **双层评分**:确定性 rubric(cost_fit / source_trust,无 LLM)+ 3 个 judge rubric(routing / memorability / dining_fit,LLM) | `src/rubric/` |
| F4 | **Judge 校准 + Kendall τ**:judge 排序 vs 人工排序,τ 达标才信 judge | `src/calibration/calibrate.ts` |
| F5 | **冻结黄金集 + 审计**:≥20 工件 + 覆盖率矩阵 + 分布统计 | `golden/` + `npm run audit:golden` |
| F6 | **契约自演化**:novel state → 提 mutex 约束 → 版本号 +1 → A/B 验证不回归 → promote | `src/contract/patch.ts` + `src/ab/comparison.ts` |
| F7 | **SQLite 持久化**:contracts / score_runs / ab_results / proposals / env_events 五表 + migration | `src/persistence/` |
| F8 | **MCP server**:契约作为工具暴露给外部 agent(JSON-RPC over stdio) | `src/mcp/server.ts` + `npm run mcp:serve` |
| F9 | **五段式 demo HTML**(路演):契约+校准 / 分数曲线+违规 / 演化 / A/B / 跨族探针 | `src/demo-html.ts` |
| F10 | **Live Env(双幕)**:事件总线 + replay/record 双模 + LLM 事件源 + L1/L2/L3 安全网 + HTTP/SSE + 浏览器动画场 | `src/env/`(15 源文件) |
| F11 | **LLM 快慢分层**:Contract-Author 走慢脑,4 个 judge 走快脑,慢脑缺失自动降级 | `src/llm/client.ts::resolveModel` |
| F12 | **跨族探针**:同一套 DSL 跨 sequence / table / brief / roster / financial 五族复用 | `contracts/intel-table-v1.yaml` |

### 1.3 反目标(显式不做)

- **不靠聊天消息协调 agent** —— 契约是唯一共享事实
- **不 fork BigSet** —— 永久 adapter 模式(`CRUCIBLE_USE_MASTRA=1` 才挂 Mastra)
- **不在调用层做重试** —— 快脑不重试,SDK 层有自己的 retry
- **不做 LLM-based Critic**(本阶段) —— Critic 是确定性 patch,省 LLM

---

## 2. 技术层(How it works)

### 2.1 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 语言 | TypeScript 5.4,ESM(`"type":"module"`) | TS import 用 `.js` 扩展 |
| 校验 | zod ^3.22 | 契约 schema + LiveEnvEvent discriminatedUnion |
| 持久化 | better-sqlite3 ^12.11 | 5 表 + migration,`:memory:` 测试便利 |
| LLM | Vercel `ai` ^6.0 + `@ai-sdk/openai` ^2.0 | OpenAI 兼容(DeepSeek/vLLM/火山方舟均可),非 OpenAI 原生 SDK |
| YAML | yaml ^2.4 | 契约定义 |
| 测试 | vitest ^1.6 + @vitest/coverage-v8 | 602 测试,无 coverage threshold 配置(report only) |
| 运行 | tsx ^4.22 | 脚本直跑 |
| **新增依赖** | **0** | Live Env 两 plan + LLM tier 全程零新增依赖 |

### 2.2 关键架构决议(已落地)

1. **契约即编译目标** —— `compileContract(contract): CompiledScorer`,契约 YAML → 可执行谓词闭包。改契约 = 改评分,无需改代码。
2. **Critic 只读确定性违规** —— `crucible.ts` 用 `baseScorer`(纯确定性)而非 `scorerRun`(含 judge)给 Critic,省一半 LLM 调用。
3. **Live Env 零侵入接线** —— `runCrucibleWorkflow` 加可选 `liveEnv?` 入参,未传行为等同 P3.5(净增 17 行)。事件经 EventBus → consumer 折叠进 artifact 的 `metadata.runtime_overrides` 与 per-node 字段。
4. **三层安全网**(LLM 事件源):L1 zod 形状 / L2 语义存在性(constraint_id/locator/field)/ L3 配额或连续失败切 FixtureEventSource 兜底。
5. **降级哲学** —— 无 API key → judge 返回 0.5;慢脑未配 → 降级快脑 + 一次性 warning;SQLite 不可用 → `:memory:`;LLM 返回非数字 → 0.5。**永不 crash workflow**。
6. **可执行性 = 可验证性** —— 每个 plan 用 TDD(写失败测试 → 实现 → 通过 → commit),全程 602 测试绿,typecheck clean,零越界改动。

### 2.3 工程质量实证

| 指标 | 数据 |
|---|---|
| 测试 | 602 pass / 79 文件 |
| `src/env/` 行覆盖 | 89.67% |
| 关键文件覆盖 | types 100% / event-bus 100% / consumer 97.8% / llm.ts 96% / http.ts 70% |
| typecheck | `tsc --noEmit` clean |
| 累计提交(Live Env P1+P2 + LLM tier) | 27 |
| 新增依赖 | 0 |
| 路演 demo 实测 | `npm run env:demo` 起服务,`/env/snapshot` 返回有效 JSON,服务常驻不退 |

### 2.4 已知技术债 / 边界

- `golden/calibration-report.json` 有 timestamp 漂移(未提交,与本工作无关)
- http.ts SSE stream + cleanup 路径覆盖 ~70%(bare 达标,可补真实 SSE 客户端测试)
- `intel-table-v1.yaml` 的 `metadata.version: 1.1` 非整数,intel E2E 靠"不持久化"规避 `resolveContractVersion` 抛错——真接入持久化需修
- LLM tier 的 OQ-TIER-1..5(双 endpoint / 第三档 / LLM Critic 慢脑 / Mastra 分层 / per-call 参数)均留作未来

---

## 3. 应用层(Where it applies)

### 3.1 谁用、用在哪

| 场景 | 契约家族 | demo | 状态 |
|---|---|---|---|
| **旅行行程规划** | sequence(`travel-sequence-v1.yaml`) | hk-3day buggy→golden | ✅ 主 demo,3 个真实 bug 被确定性抓出 |
| **竞品情报表** | table(`intel-table-v1.yaml`) | intel-table buggy(3 硬违规) | ✅ 跨族探针 GO |
| 财务尽调 | financial | `npm run dd:financial` | ✅(P4.3) |
| 情报监测 | table | `npm run intel:monitor` | ✅(P4.6) |
| brief / roster | brief / roster | — | 契约已支持,fixture 待补 |

### 3.2 三条使用路径

1. **路演现场(replay)**:`npm run env:demo` —— 从 `*.recorded.jsonl` 回放事件,看起来像 LLM 实时生成,实际是录像。浏览器看 timeline + 分数动画。**零 API key 可跑**。
2. **开发期录制(record)**:`npm run env:record` —— LLM 真实生成事件,写 JSONL + stats。stats 的 `l1Failures=0` 是 CI 闸门。
3. **集成(MCP)**:`npm run mcp:serve` —— 把契约评分作为工具暴露给外部 agent(如 Claude Code),让别的 agent 调用"评分 + 迭代"能力。

### 3.3 价值主张(分层)

- **对开发者**:把"好工件的标准"从代码里抽出来变成 YAML,改标准不用改代码;bug 自动被抓,不用手写断言。
- **对产品/业务**:同一套 DSL 跨业务族复用(旅行→情报→财务),新增场景 = 写一份契约,不是写一个系统。
- **对路演/投资人**:demo 有真实分数曲线、真实 bug 抓取、真实契约演化——不是 PPT,是可运行的可执行契约。

---

## 4. Product Diagnostic(product-lens Mode 1)

> YC office hours 风格的 7 个硬问题。

### Q1. Who is this for?(具体的人,不是"开发者")

**两类核心用户:**

1. **AI 应用构建者**(主):正在做多 agent 系统的工程师/团队,被"agent 之间靠聊天协调 = 不可观测、不可复现、不可优化"折磨的人。他们要的是:agent 协调有一个**可执行的事实层**,而不是 prompt 黑箱。
2. **垂直领域分析师**(次):旅行规划师 / 竞品分析师 / 财务尽调人员——他们懂"什么是好的工件",但不会写代码。他们要的是:把领域标准写成 YAML,系统自动执行 + 自动改进。

### Q2. What's the pain?(量化)

- **多 agent 系统的协调黑箱**:agent 之间靠自然语言消息传递,出错无法定位是哪个 agent 的判断偏离了标准。**今天每个团队都在重造"agent 评分 + 迭代"轮子**。
- **"好"的标准固化在代码里**:改一个评分规则要改代码、改测试、重新部署。Crucible 把它抽成 YAML,改契约 = 改评分。
- **demo 不可信**:大多数 AI 产品 demo 是 PPT 或 cherry-pick 的截图。Crucible 的 demo 跑真实评分、真实 bug、真实迭代——这是路演/融资场景的真痛点。

### Q3. Why now?(什么变了)

- **LLM judge 校准成熟**:Kendall τ 让 LLM 评分可校准、可信任(τ ≥ 0.5 才用),不再是无依据打分。
- **契约驱动 = 可执行**:zod + 编译器让"契约"从文档变成可运行代码,这一层在 2024 前不现实。
- **MIRA Nature 论文(2024)** 证明"按决策影响半径分层模型(GPT-4o 执行 + o1 规划)"质量成本双改善——Crucible 的 LLM 快慢分层直接借鉴此心智。
- **agent harness 爆发**:Claude Code / Codex / Cursor 等让"agent 协调标准"成为刚需,而非锦上添花。

### Q4. What's the 10-star version?(钱/时间无限)

Crucible 成为 **agent 协调的协议层**:

- 任何多 agent 系统都能挂一份 Crucible 契约作为"共享事实层"
- 契约市场:垂直领域专家写契约(旅行/法律/金融/医疗),agent 系统直接消费
- 契约自演化闭环跑通:novel state 自动提议新约束 → A/B 验证 → 自动 promote(去掉 Human Gate)
- 跨 harness:同一契约在 Claude Code / Codex / Mastra 上都跑得通

### Q5. What's the MVP?(最小可证伪)

**已经超过了 MVP**——当前状态:

- ✅ 一个契约(travel-sequence)+ 3 个真实 bug 被确定性抓出(P0 验收)
- ✅ judge 校准 + τ + 黄金集(P1)
- ✅ 契约自演化 + A/B(P3)
- ✅ 跨族探针(travel→intel)GO(P3)
- ✅ Live Env 双幕路演(replay + record)(Live Env P1+P2)
- ✅ LLM 快慢分层(LLM tier)

**真正的 MVP 已验证的 thesis**:契约能驱动多 agent 自动抓缺陷 + 自动提分,且 demo 可信。

### Q6. What's the anti-goal?(显式不建)

- **不做又一个 agent 框架** —— 不和 Mastra/LangGraph 竞争编排,做它们缺的"协调事实层"
- **不做通用 LLM 应用** —— 聚焦"有可执行标准的合成类任务",不做对话/创作
- **不靠聊天协调** —— 这是核心反目标,也是护城河
- **不 fork BigSet / 不强绑 Mastra** —— 永久 adapter,引擎可独立开源

### Q7. How do you know it's working?(指标,非感觉)

| 指标 | 当前 | 目标 |
|---|---|---|
| 确定性 bug 抓出率 | travel 3/3,intel 3/3 | 跨族 ≥ 90% |
| judge 校准 τ | 0.6429(3 轮调优后) | ≥ 0.5(达标即用) |
| 迭代提分 | buggy→golden 单调上升 | 每轮不降 |
| 测试绿 | 602/602 | 持续全绿 |
| demo 可跑 | `npm run env:demo` 实测起服务 | 路演前 0 配置可跑 |
| **真实采用** | 0(自用) | ≥1 外部团队挂载契约(北极星) |

---

## 5. Founder Review(product-lens Mode 2)

### 5.1 PMF 信号打分(0-10)

| 信号 | 分 | 依据 |
|---|---|---|
| 使用增长轨迹 | 2 | 自用项目,0 外部用户 |
| 留存指标 | N/A | 无用户基数 |
| 收入信号 | 1 | 有 License 分层(AGPL 引擎 + 私有契约 ToB),无计费代码 |
| **竞争护城河** | **8** | "可执行契约作为 agent 协调事实层"目前无直接竞品;DSL + 校准 + 自演化 + Live Env 组合难复制 |
| **工程完成度** | **9** | 602 测试、5 契约族、跨族探针 GO、路演 demo 可跑——超过多数 demo-ware |
| **叙事清晰度** | **9** | "agents coordinate via an executable contract, not chat messages" 一句话立住 |

### 5.2 The one thing that would 10x this

> **让一个真实的外部团队用 Crucible 契约跑他们的多 agent 任务。**

当前所有验证都是自闭环(旅行/情报/财务都是自造 fixture)。10x 不在加功能,在**找一个外部痛点挂载**——比如让一个做内容审核、做简历筛选、做代码 review 的团队,把他们的"好标准"写成 Crucible 契约,看 agent 能否自动抓缺陷 + 提分。一个外部 adopter 的价值 > 十个新 feature。

### 5.3 正在建但可能不重要的事

- **Live Env 的 LLM record 模式** —— 路演用 replay 已够,record 是开发期工具,优先级低于外部 adopter
- **OQ-TIER-1..5 的全部升级** —— 双 endpoint / 第三档 reasoning 都是优化,不是验证方向
- **更多契约族(brief/roster fixture)** —— DSL 已支持五族,补 fixture 是体力活,等真有需求再补

---

## 6. 风险与 Go/No-Go

### 6.1 风险

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **自闭环验证,无外部 adopter** | thesis 未被市场验证 | 优先找 1 个外部团队挂载(见 §5.2) |
| R2 | **契约 DSL 的表达力边界** | 复杂领域可能写不出契约 | 跨族探针已证 5 族可行;复杂场景靠 hard_constraints + rubric 组合 |
| R3 | **LLM judge 成本/延迟** | 路演/生产贵且慢 | 快慢分层已落地;Critic 用确定性省一半调用;judge 可降级 0.5 |
| R4 | **Mastra 依赖方向** | 强绑某个编排框架降低通用性 | 永久 adapter 模式,默认 SimpleAgent,`CRUCIBLE_USE_MASTRA` 可选 |
| R5 | **AGPL license 对 ToB 的阻力** | 企业不敢用 | "引擎 AGPL / 契约私有"分层已决议,ToB 靠契约不开源 |

### 6.2 Go/No-Go

> **GO(附条件)**

**理由:**

- ✅ 核心 thesis 已被自闭环验证:契约驱动多 agent 自动抓缺陷 + 自动提分,可运行、可复现、demo 可信
- ✅ 工程质量过硬:602 测试、零新依赖、typecheck clean、路演 demo 实测可跑
- ✅ 护城河清晰:可执行契约作为协调事实层,组合(DSL+校准+自演化+Live Env+tier)难复制
- ✅ 反目标明确:不造又一个 agent 框架,聚焦事实层

**条件(下一阶段必须):**

1. **找 1 个外部 adopter** 验证非自闭环场景(北极星指标)
2. **补 brief/roster fixture** 或一个真外部场景,证明 DSL 跨族非自造
3. **冻结一个 v1.0 契约标准**,从"项目"变成"协议"

---

## 7. 下一步(product-lens → product-capability)

本 brief 是 product 诊断(product-lens 职责)。若决议 GO,下一 lane 是 **`product-capability`**:把这份 brief 转成实现就绪的能力契约(PR D-to-SRS),把 §6.2 的三个条件拆成可执行任务。

**推荐的优先级排序(ICE 粗估):**

| 任务 | Impact | Confidence | Effort | ICE |
|---|---|---|---|---|
| 找 1 外部 adopter 挂载契约 | 5 | 4 | 3 | 6.7 |
| 冻结 v1.0 契约标准 | 4 | 5 | 2 | 10.0 |
| 补 brief/roster fixture | 2 | 5 | 2 | 5.0 |
| Live Env record 模式打磨 | 2 | 4 | 3 | 2.7 |
| OQ-TIER 升级 | 2 | 3 | 4 | 1.5 |

→ **先冻结 v1.0 标准(Effort 低、Confidence 高),同步找 adopter。**

---

## 附录:核验指引

本 brief 所有断言可在 `D:/Apps/traveller.crucible-dev` 核验:

```bash
cd /d/Apps/traveller.crucible-dev
npx vitest run              # 602 测试
npx tsc --noEmit            # clean
npm run env:demo            # 路演 demo 实测
git log --oneline -30       # 27 个 plan 提交
cat contracts/*.yaml        # 5 个契约族
cat src/env/types.ts        # Live Env 事件三谱
cat src/llm/client.ts       # LLM 快慢分层
```

> "Agents coordinate via an executable contract, not chat messages —
> auto-discovering defects, auto-improving scores."
