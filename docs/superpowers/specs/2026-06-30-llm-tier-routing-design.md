# LLM Tier Routing — 快慢分层调用设计

> 类型:Design Spec(brainstorming → writing-plans 之间的设计稿)
> 日期:2026-06-30
> 分支起点:`crucible/p4.6-intel-deepen`(HEAD `dd7a061`)
> 出处:MIRA Nature 论文(GPT-4o 执行 + o1 规划)启发的"按决策影响半径分层"
> 关联文档:`references/articles/MIRA-medical-agent-nature.md`(parent worktree)

---

## 1. 背景与动机

当前 Crucible 的 5 处 LLM 调用点全部经 `src/llm/client.ts::callLLM` 走同一个 `OPENAI_MODEL`:

| 调用点 | 影响半径 |
|---|---|
| `src/agents/contract-author.ts` | **大**(契约修订决定后续所有评分) |
| `src/rubric/routing.judge.ts` | 小(单工件单维度) |
| `src/rubric/memorability.judge.ts` | 小 |
| `src/rubric/dining_fit.judge.ts` | 小 |
| `src/rubric/strategic_insight.judge.ts` | 小 |

MIRA 论文用 GPT-4o(快脑/执行)+ o1(慢脑/规划)的分层证明:**把"重要的事"与"廉价并行的事"分到不同模型,质量与成本同步改善**。Crucible 同样存在天然的影响半径分层,但当前全栈共用同一模型,既浪费(judge 用不到深思考)又有限(contract 修订得不到深思考)。

## 2. 范围与非范围

### 本设计在范围内

- 给 `callLLM` 加可选 `tier: 'fast' | 'slow'` 参数(默认 `'fast'`,完全向后兼容)
- 引入新 env `OPENAI_MODEL_SLOW`(可选,缺失自动降级)
- 把 `contract-author.ts` 切换到 `tier='slow'`
- 新增 1 个测试文件覆盖 tier 路由 + 降级

### 不在本设计范围(显式排除)

- 不动 4 个 judge(默认 `'fast'` 等价于现行为)
- 不动 `mastra-adapter.ts`(P3.5 §2.1.2 决议自研编排,Mastra 路径无人走)
- 不引入双 endpoint / 双 API key(A1 决议,留作未来 A2)
- 不引入 temperature / max_tokens 参数化(YAGNI,留作未来 D3)
- 不升级 Critic 为 LLM-based(C1 决议,留作独立 spec)
- 不改 contract YAML / engine / schema / 现有 485 测试用例

## 3. 决议汇总(brainstorming 5 题)

| 维度 | 决议 | 关键理由 |
|---|---|---|
| 分层边界 | A · 按"决策影响半径"二分 | 与 MIRA 一致,改动面最小 |
| 模型挑选 | A1 · 同 endpoint + 新增 `OPENAI_MODEL_SLOW` | 与现有 env 习惯一致,落地最快 |
| 慢脑降级 | B1 · 缺失/失败时自动退回快脑 + 启动日志 | 延续"无 key 不崩,只降效果"哲学 |
| 调用点范围 | C1 · 只动 Contract-Author | 单刀切薄,验完接口再扩 |
| API 形态 | D1 · `callLLM(prompt, tier='fast')` 可选第二参 | 真正 additive,judge 0 改动 |

## 4. 架构

```
┌──────────────────────────────────────────────────────────┐
│  Caller                  callLLM(prompt, tier='fast')    │
│  ┌──────────────┐                  │                     │
│  │ judge × 4    │──tier 默认 fast──┤                     │
│  └──────────────┘                  │                     │
│  ┌──────────────┐                  │                     │
│  │ contract-    │──tier='slow'─────┤                     │
│  │ author       │                  ▼                     │
│  └──────────────┘     ┌──────────────────────┐           │
│                       │   resolveModel(tier) │           │
│                       │   slow: SLOW || FAST │           │
│                       │   fast: FAST || 默认 │           │
│                       └──────────┬───────────┘           │
│                                  ▼                       │
│                       generateText({ model })            │
│                       同一 endpoint / 同一 API key       │
└──────────────────────────────────────────────────────────┘
```

### 环境变量(完全向后兼容)

| 变量 | 作用 | 缺失行为 |
|---|---|---|
| `OPENAI_API_KEY` | API 鉴权(现有) | `callLLM` 返回 `null`(现有) |
| `OPENAI_BASE_URL` | endpoint(现有) | 默认 `https://api.openai.com/v1`(现有) |
| `OPENAI_MODEL` | **快脑模型名**(语义微调,沿用现有) | 默认 `'gpt-4o'`(现有) |
| `OPENAI_MODEL_SLOW` | **慢脑模型名**(新增) | 退回 `OPENAI_MODEL` + 首次 warning |

### 降级链

```
tier='slow' → OPENAI_MODEL_SLOW (未设) → OPENAI_MODEL → 'gpt-4o' (硬编默认)
tier='fast' → OPENAI_MODEL (未设) → 'gpt-4o' (硬编默认)
```

### 可见性

`callLLM` 首次被以 `tier='slow'` 调用且 `OPENAI_MODEL_SLOW` 未设时,打印一次:

```
[LLM] tier=slow not configured, falling back to fast (set OPENAI_MODEL_SLOW to enable)
```

进程内只打 1 次(模块级 `slowFallbackWarned` flag 去重)。

## 5. 组件清单

### 改 1:`src/llm/client.ts`

新增导出 `ModelTier` 类型和 `resolveModel` 纯函数;给 `callLLM` 加可选第二参:

```ts
export type ModelTier = 'fast' | 'slow';

// 模块级去重 flag(进程内只 warn 1 次)
let slowFallbackWarned = false;

export function resolveModel(tier: ModelTier): string {
  const fast = process.env.OPENAI_MODEL || 'gpt-4o';
  if (tier === 'fast') return fast;
  const slow = process.env.OPENAI_MODEL_SLOW;
  if (slow) return slow;
  if (!slowFallbackWarned) {
    console.warn('[LLM] tier=slow not configured, falling back to fast (set OPENAI_MODEL_SLOW to enable)');
    slowFallbackWarned = true;
  }
  return fast;
}

export async function callLLM(prompt: string, tier: ModelTier = 'fast'): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENAI_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = resolveModel(tier);   // ← 唯一逻辑变更
    const result = await generateText({ model: openai.chat(model), prompt });
    return result.text;
  } catch (err) {
    console.warn(`[LLM] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
```

### 改 2:`src/agents/contract-author.ts`

1 行改动 + 1 行说明性注释:

```ts
// tier='slow':contract 修订影响半径大(决定后续所有评分),走慢脑
const raw = await callLLM(prompt, 'slow');
```

### 增 3:`tests/llm/client.test.ts`

新文件,vitest,8 个用例(详见 §8)。

### 增 4(可选,不阻塞):`.env.example`

追加 1 行示例与注释(若 `.env.example` 现有):

```
# 慢脑模型(可选)— 用于 Contract-Author 等决策影响半径大的调用
# 未设时自动降级到 OPENAI_MODEL
# OPENAI_MODEL_SLOW=deepseek-r1
```

## 6. 数据流

### 路径 A:慢脑正常(配置齐全)

```
contract-author.ts → callLLM(prompt, 'slow')
  → hasApiKey() → true
  → resolveModel('slow') → OPENAI_MODEL_SLOW='deepseek-r1' → 'deepseek-r1'
  → generateText({ model: openai.chat('deepseek-r1'), prompt })
  → return result.text
contract-author.ts ← 修订草稿 → Human Gate
```

### 路径 B:慢脑降级(`OPENAI_MODEL_SLOW` 未设)

```
contract-author.ts → callLLM(prompt, 'slow')
  → hasApiKey() → true
  → resolveModel('slow') →
       SLOW 未设 →
       slowFallbackWarned=false → warn 1 次 → slowFallbackWarned=true →
       返回 OPENAI_MODEL='deepseek-v3'
  → generateText({ model: openai.chat('deepseek-v3'), prompt })
  → return result.text
```

### 路径 C:无 API key(完全降级,现有行为不变)

```
callLLM(prompt, 'slow')
  → hasApiKey() → false → return null
contract-author.ts ← null → 兜底"不修订"
```

### 路径 D:快脑(judge × 4,完全不变)

```
routing.judge.ts → callLLM(prompt)        ← 不传 tier
  → tier 默认 'fast'
  → resolveModel('fast') → OPENAI_MODEL='deepseek-v3'
  → 同现有行为
```

### 关键不变性

- 不传 tier 时,`callLLM(prompt)` 行为与现有完全一致
- `slowFallbackWarned` 模块级,进程内只 warn 1 次(适合 long-running 进程)
- `resolveModel` 是纯函数(除首次 warning),易测

## 7. 错误处理与降级

### 失败矩阵

| # | 失败场景 | 触发条件 | 行为 | workflow 影响 |
|---|---|---|---|---|
| 1 | 无 API key | `OPENAI_API_KEY` 未设 | `callLLM` 返回 `null`(现有) | judge → 0.5;contract-author → 不修订 |
| 2 | 慢脑未配置 | `OPENAI_MODEL_SLOW` 未设 + tier='slow' | 退回快脑 + 首次 warning | **正常推进**(用快脑评估的契约修订) |
| 3 | 模型名不存在 | `OPENAI_MODEL_SLOW='foobar'` → 404 | `generateText` throw → 现有 catch → 返回 `null` + warning | contract-author → 不修订 |
| 4 | 网络/超时 | TCP 失败 / 限流 / 5xx | 同上,catch + null + warning | 同上 |
| 5 | 返回空文本 | LLM 返回 `""` 或纯空白 | 现有:返回 `result.text`;调用方负责处理 | judge 用 `parseJudgeScore` 兜底 0.5;contract-author 有空响应分支 |
| 6 | 双 env 都未设 | `OPENAI_MODEL_SLOW` + `OPENAI_MODEL` 都未设 | fall through 到 `'gpt-4o'` + 首次 warning | 模型名兜底,workflow 继续 |
| 7 | tier 参数非法 | TS 类型错(理论上 tsc 拦截) | 若被 JS 绕过 → 默认按 'fast' 处理 | 安全降级 |

### 设计原则

- **不引入新异常类型** — 延续"返回 null + warning",调用方无需新 try/catch
- **不改 `hasApiKey` 语义** — 它只看 API key,模型名"未配置"在 `resolveModel` 内 warn
- **不在调用层做重试** — 现有快脑也不重试,SDK 层有自己的 retry,不在外面叠
- **配置时降级,不是调用时降级** — `resolveModel` 提前查 env,零成本;运行时失败仍走"返回 null"

### Warning 治理

只有 2 条 warning,都是模块级 once:
1. `slowFallbackWarned` — 慢脑未配置自动降级(本设计新增)
2. (现有的)`OPENAI_API_KEY missing, judge will use neutral 0.5` — 不变

## 8. 测试策略

### 新文件:`tests/llm/client.test.ts`

**Mock 策略**:
- `process.env` 用 `vi.stubEnv` / `vi.unstubAllEnvs` 隔离
- `slowFallbackWarned` 模块级 flag 用 `vi.resetModules()` 在 beforeEach 重置
- `generateText` 用 `vi.mock('ai', ...)` mock 掉,断言它收到的 `model` 参数

**用例清单(8 个)**:

```ts
describe('llm/client.ts · resolveModel', () => {
  it('fast tier 读 OPENAI_MODEL');
  it('fast tier 缺失时退到 gpt-4o');
  it('slow tier 优先读 OPENAI_MODEL_SLOW');
  it('slow tier 缺失 SLOW 时降级到 FAST');
  it('slow tier 双缺失时降级到 gpt-4o');
  it('slow tier 首次降级 warn,第二次静默');
});

describe('llm/client.ts · callLLM tier 路由', () => {
  it('不传 tier 等价于 fast(向后兼容)');
  it('tier=slow 用 SLOW 模型');
});
```

### 不写的测试(YAGNI)

- 不测无 API key 路径(现有 `tests/rubric/strategic_insight.test.ts` 已覆盖 mock fallback)
- 不测 `generateText` 失败路径(外部依赖,现有 try/catch 已覆盖且改动未涉及)
- 不测 `contract-author` 的 `'slow'` 调用(`callLLM` tier 路由单测过即可)

### 回归验证

- `npx tsc --noEmit` clean
- `npx vitest run` → **485 + 8 = 493** 测试全绿
- `npx vitest run tests/agents/contract-author.test.ts` 单独跑一次,确认 1 行改动不破坏现有测试

### 手测(可选,不阻塞 PR)

配 `OPENAI_MODEL_SLOW=<某个真模型>` 跑一次 `npm start --llm`,看日志里是否走慢脑。

## 9. 验收

| 项 | 标准 |
|---|---|
| TS 类型 | `npx tsc --noEmit` clean |
| 自动测试 | 493 / 493 绿(原 485 + 新 8) |
| 向后兼容 | 不传 tier / 不设 `OPENAI_MODEL_SLOW` 时,行为与改动前完全一致 |
| 降级可见 | 慢脑未配置时启动日志可见 warning,且**只打 1 次** |
| 改动面 | ≤ 3 文件改 + 1 文件增(+ 可选 `.env.example`) |

## 10. 留作未来的开放问题(OQ)

| ID | 问题 | 触发升级时机 |
|---|---|---|
| OQ-TIER-1 | 是否扩展到双 endpoint(A2)? | 当成本/延迟敏感到值得用两家服务商时 |
| OQ-TIER-2 | 是否引入第三档 `'reasoning'`(C 方案)? | 当出现"慢脑都嫌不够,需要 o1-pro/r1-large"的场景时 |
| OQ-TIER-3 | 是否给 LLM-based Critic 启用慢脑? | 当 Critic 升级为 LLM-based(独立 spec)时 |
| OQ-TIER-4 | 是否让 Mastra adapter 也分层? | 当真正启用 `CRUCIBLE_USE_MASTRA=1` 路径时 |
| OQ-TIER-5 | 是否引入 per-call `temperature` / `maxTokens`? | 当某调用点对参数敏感时(D3 方案) |

---

## 附录 A · brainstorming 决议树

```
分层边界 → A(影响半径二分) ✓
            B(链长二分)
            C(三档)
                │
                ▼
模型挑选 → A1(同 endpoint + 新 env) ✓
            A2(双 endpoint)
            A3(同模型调参)
                │
                ▼
慢脑降级 → B1(自动退快脑 + warn) ✓
            B2(硬失败)
            B3(跳过 Contract-Author)
                │
                ▼
调用范围 → C1(只动 Contract-Author) ✓
            C2(预留 Critic 接口)
            C3(同时升级 LLM Critic)
                │
                ▼
API 形态 → D1(可选第二参) ✓
            D2(双具名函数)
            D3(options 对象)
                │
                ▼
实施形态 → E1(单文件 + 单 env) ✓
            E2(E1 + Mastra adapter)
```

每一档都明确否决了"为未来过度设计"的更大方案,把 PR 压到 3 文件大小,验证 tier 路由这条新接口本身,后续 OQ-TIER-1..5 任一升级都不破坏本设计。
