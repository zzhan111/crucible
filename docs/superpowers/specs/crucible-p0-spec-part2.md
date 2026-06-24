# Crucible P0 MVP Spec — Part 2 Supplement

> Part 1 已执行完成(54 tests pass,commit 2305815)。本补充基于 Part 1 **实测代码**定义 Part 2 范围 + 接口契约,作为 Part 2 plan 的输入。

---

## 1. Part 2 Goal

在 Part 1(契约内核 + 确定性打分)之上,加 LLM judge + 5 个 Mastra agent + workflow 编排 + 提分迭代回路,完成 PRD P0 验收 4.2(分数单调上升)/ 4.3(多智能体协同可观测)/ 4.4(契约版本化)。

## 2. Part 1 实测接口(Part 2 复用)

**已稳定,直接复用:**
```typescript
// src/contract/schema.ts
export const ContractSchema: z.ZodObject<...>
export type Contract = { artifact_family, fields, hard_constraints, rubric, calibration }
export type RubricEntry = { dim, weight, mode: 'deterministic'|'judge'|'proxy+judge' }

// src/contract/validate.ts
export function loadContract(path: string): Contract

// src/contract/compiler.ts
export function compileContract(contract: Contract): CompiledScorer
// ⚠️ CompiledScorer 当前未导出,Part 2 Task 0 要先加 export

// src/predicates/types.ts
export interface Artifact { family, nodes: ArtifactNode[], metadata? }
export interface ArtifactNode { [fieldName: string]: unknown }
export interface Violation { constraint_id, severity, message, location, fix_hint? }
export type Predicate = (artifact: Artifact) => Violation[]

// src/rubric/types.ts
export interface RubricScore { dim, score, mode, rationale, proxy_value? }
export type DeterministicRubric = (artifact: Artifact) => RubricScore

// src/scorer/types.ts
export interface ScoreReport { deterministic, judge: {...}|null, final_score }
export interface Scorer { score(artifact: Artifact): ScoreReport }  // ⚠️ 同步,Part 2 要 async

// src/fixtures/
export const hk3dayGolden: Artifact   // 5 nodes, 0 violations
export const hk3dayBuggy: Artifact    // 2 nodes, 3 hard violations (continuity+state_mutex+no_duplicate_state)
```

## 3. Part 1 → Part 2 接口调整(Task 0 必做)

**调整 1:导出 `CompiledScorer`**
```typescript
// src/contract/compiler.ts 追加
export interface CompiledScorer extends Scorer {
  deterministicPredicateCount: number;
  deterministicRubricCount: number;
}
```
当前 `CompiledScorer` 是内部 interface,Part 2 的 `JudgeAugmentedScorer` 要 import 它。Task 0 加 `export`。

**调整 2:`Scorer` 接口扩展为 async(或新建 `AsyncScorer`)**

Part 1 `Scorer.score` 是同步的。Part 2 judge 要调 LLM(async)。两个选择:
- **A. 改 `Scorer.score` 为 `Promise<ScoreReport>`** — 破坏 Part 1 接口,所有调用点要 await
- **B. 新建 `AsyncScorer` 接口** — Part 1 `Scorer` 不动,Part 2 用 `AsyncScorer`

**选 B**(不破坏 Part 1)。Part 2 定义:
```typescript
// src/scorer/types.ts 追加
export interface AsyncScorer {
  score(artifact: Artifact): Promise<ScoreReport>;
}
```
`JudgeAugmentedScorer implements AsyncScorer`。Part 1 的 `compileContract` 仍返回同步 `CompiledScorer`,`JudgeAugmentedScorer` 内部调用它(同步部分直接 await 同步值即可)。

## 4. Part 2 范围

### 4.1 LLM Judge Rubric(3 个维度,对应 Contract 已声明的 judge/proxy+judge mode)

- `routing` (proxy+judge, weight 0.25) — proxy = 确定性计算的"transit/switch 桥接覆盖率"(Part 1 continuity 逻辑可复用);judge = LLM 评估"动线是否顺滑"
- `memorability` (judge, weight 0.25) — 纯 LLM 评估"记忆点密度"
- `dining_fit` (judge, weight 0.15) — 纯 LLM 评估"餐饮安排是否符合偏好"

每个 judge rubric:
- 输入:`JudgeContext { artifact, dim, weight, proxy_value? }`
- 输出:`RubricScore { dim, score: 0-1, mode, rationale, proxy_value? }`
- LLM:Vercel AI SDK + OpenRouter→Claude(sonnet),温度 0.2
- 降级:无 API key → 返回 0.5 neutral + 警告日志(spec §8)

### 4.2 5 个 Mastra Agent

| Agent | 职责 | 实现 |
|---|---|---|
| Contract-Author | 起草/修订 Contract YAML(P0 只读现有) | Mastra Agent 包装 + 纯函数 `contractAuthorRead` |
| Scorer | 跑确定性 + judge,产出 ScoreReport | Mastra Agent 包装 + `scorerRun` async 函数 |
| Judge (fan-out) | 并行跑 3 个 judge rubric | Mastra Agent 包装 + `judgeFanOut` async 函数 |
| Critic | 读 ScoreReport + Violations,生成 artifact patch | 纯函数 `generatePatches`(P0 确定性,不调 LLM) |
| Curator | 检测新颖度,提议契约扩张(P0 只检测不合并) | 纯函数 `detectNovelty` |

### 4.3 Workflow 编排

```
runCrucibleWorkflow(artifact, contract, baseScorer):
  for i in 1..MAX_ITERATIONS(3):
    1. Scorer: score(artifact) → ScoreReport(deterministic + judge 填充)
    2. Critic: generatePatches(ScoreReport, artifact) → ArtifactPatch[]
    3. applyPatches(artifact, patches) → artifact v(n+1)
    4. Curator: detectNovelty(artifact, knownStates) → ExpansionProposal[]
       writeProposal(each) → contracts/proposals/*.yaml + git commit
    5. 重新 score(patched artifact) → 看是否提升
    6. 终止:提升 < 0.01 或达 3 轮
```

### 4.4 提分迭代回路(验收 4.2)

- v1(buggy) → score → critic → v2 → score → critic → v3 → score
- **分数必须严格单调上升**:v1 < v2 < v3
- 至少 2 轮(能看出单调性),最多 3 轮
- 终止条件:提升 < 0.01 或达 3 轮
- **关键**:确定性违规修复后分数必然上升(硬约束违规扣 0.15/个,修掉 3 个 = +0.45),judge 部分即使 neutral 0.5 也不影响单调性

### 4.5 可观测(验收 4.3)

- 日志打 `[Scorer]/[Critic]/[Curator]/[Workflow]/[Judge]` tag
- Mastra Studio(:4111)能跑就跑,跑不起来用日志替代
- 验收测试断言日志含 5 个 agent tag

### 4.6 契约版本化(验收 4.4)

- Curator 提议扩张时,写 `contracts/proposals/<timestamp>-<dim>.yaml` + git commit
- 验收测试:跑 workflow 后,proposals 目录有 .yaml 文件

## 5. Part 2 技术栈新增

- `@mastra/core` — agent + workflow 编排
- `ai` (Vercel AI SDK) — LLM 调用
- `@openrouter/ai-sdk-provider` — OpenRouter provider
- `dotenv` — 加载 .env 的 OPENROUTER_API_KEY

## 6. Part 2 不做(留 P1+)

- Contract-Author 自动 LLM 修订(P0 只读)
- Curator 自动合并契约扩张(P0 只检测+提议)
- 冻结黄金集校准 judge(P0 不校准)
- champion-challenger A/B
- 情报表探针(第二族)
- UI/前端(P0 是 CLI + Studio/日志)
- 采集层(P2)
- MCP server(P2)

## 7. 关键风险与降级

| 风险 | 降级 |
|---|---|
| OpenRouter API key 缺失 | judge 返回 0.5 neutral + 警告;workflow 仍跑通,验收 4.2 依赖确定性违规修复(分数仍上升) |
| Mastra Studio Windows 跑不起来 | 日志打 agent DAG + JSON,验收 4.3 用日志 |
| LLM 返回非数字分数 | parseJudgeScore 解析失败返回 0.5 + 警告,不 crash |
| Critic 生成的 patch 不提分 | 终止条件保护:提升 < 0.01 停止,不无限循环 |
| git commit 失败 | proposal 写文件但不 commit,验收 4.4 用文件存在性替代 |
| Mastra 依赖安装失败 | 降级为纯 TypeScript + Promise.all 实现 agent fan-out,不用 Mastra(保留 workflow 逻辑) |
