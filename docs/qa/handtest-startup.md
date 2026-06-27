# Crucible 启动手测 QA 清单

> 一键启动入口:`bash scripts/start.sh`(或 `npm start`)。本清单是"真人手测端到端跑通"的对照表,每条给出**命令**与**预期结果**,可逐条判 pass/fail。
> Worktree:`D:\Apps\traveller.crucible-dev` · 分支 `crucible/dev`

## 模式说明

| 模式 | 命令 | judge 行为 | 是否调计费 API |
|---|---|---|---|
| 降级(默认) | `bash scripts/start.sh` | neutral 0.5 | 否 |
| 真实 LLM | `bash scripts/start.sh --llm` | 真实打分 + τ 校准 | **是** |

无 `OPENAI_API_KEY` 时自动降级,workflow 仍跑通,**仅 τ 校准显示 skipped**。这是设计内的安全网,不是故障。

---

## A. 冷启动(核心,必跑)

**命令**
```bash
cd /d/Apps/traveller.crucible-dev
bash scripts/start.sh
```

**预期结果**(脚本按序执行 6 步,任一步失败即停)

| 步骤 | 预期 |
|---|---|
| 1 前置检查 | `✓ node vX, npm Y` |
| 2 依赖 | `✓ 依赖已就绪` 或自动 `npm install` 后 `✓ 依赖已安装`;`✓ better-sqlite3 native binding 可加载` |
| 3 .env | `✓ .env 中有 OPENAI_API_KEY` **或** `! 无 OPENAI_API_KEY → judge 降级`(后者正常) |
| 4 typecheck | `✓ typecheck 通过`(`npm run typecheck` 无报错) |
| 5 测试 | vitest 全绿,末行类似 `Test Files  N passed`;`✓ 全部测试通过(含 e2e …)` |
| 6 HTML 报告 | `✓ 报告已生成: …/demo-report.html` |

**Pass 判据**:脚本以 `✓ 端到端启动完成` 收尾,且 `demo-report.html` 真实存在于 worktree 根。

**重要:第 6 步是否调 LLM 取决于 `.env`。** 第 5 步测试始终降级(`tests/setup-env.ts` 强制删 key);但第 6 步 `demo-html.ts` **自加载 `.env`**——`.env` 有 key 时会真实调 LLM(τ 出真实值,会计费),无 key 时降级(τ=skipped)。若想强制降级不计费:临时 `mv .env .env.bak` 再跑,跑完 `mv` 回来。

---

## B. 端到端闭环(e2e 自动覆盖)

无需单独手测——A 的第 5 步已自动验证。对应 `tests/e2e/iteration.test.ts`,断言如下:

| 验收点 | 断言 | 说明 |
|---|---|---|
| 4.2 分数上升 | `scores` 非递减 + (有严格提升 或 最终 violations=0) | 无 key 时 det 0.55→1.0 |
| 违规清零 | 最终 `violations === 0` | Critic 修复全部硬约束 |
| 4.3 多智能体可观测 | 日志含 `[Scorer]` `[Critic]` `[Curator]` `[Workflow]` + `judge fan-out` | 降级模式靠日志代替 Studio |
| 4.4 契约版本化 | `contracts/proposals/` 出现新 `.yaml` | Curator 检测到新颖 state 写 proposal |

**Pass 判据**:A 第 5 步 vitest 全绿即覆盖。若想直接看 e2e:`npm test -- e2e`。

---

## C. HTML 报告手测

**命令**:浏览器打开 `demo-report.html`。

**预期**:五段全在。τ 是否有真实值**取决于 `.env` 是否有 key**(见 A 段说明)。

| 段 | 元素 | 有 key(真实 LLM) | 无 key(降级) |
|---|---|---|---|
| 1 契约 + 校准 | Contract 卡片 + τ 仪表盘 | τ 显示真实数值(如 0.4286),pass/fail | τ=skipped,灰色 |
| 2 跑分抓 bug | 分数曲线 SVG + 违规卡(3 条:continuity/state_mutex/no_duplicate_state) | 曲线含 judge 贡献 | 曲线为确定性分 |
| 3 契约自演化 | 版本时间线(v1 baseline → v2 +beach_hiking_mutex approved) | 正常 | 正常 |
| 4 A/B 对比 | champion vs challenger τ 柱状图 | τ 有真实值 | τ=0,retain |
| 5 跨族探针 | Travel→Intel-Table **✓ GO** 徽章 + 表格 | 正常 | 正常(go/no-go 是确定性判定) |

**Pass 判据**:五段标题齐全;段 5 显示 ✓ GO(intel-table buggy 抓出 3 违规、golden 0 违规)。

---

## D. 真实 LLM 模式(可选,会计费)

**前提**:`.env` 已填 `OPENAI_API_KEY`(支持 OpenAI 官方 / DeepSeek / 任意 OpenAI 兼容 endpoint,配 `OPENAI_BASE_URL` + `OPENAI_MODEL`)。

**命令**
```bash
bash scripts/start.sh --llm
```

**预期**:在 A 的 6 步之后,额外跑 `demo-p1.ts` 五段式 console。
- 模式行显示 `真实 LLM Judge (deepseek-v4-flash)`(或你配的模型)。
- 段 1 校准:`τ = 0.xxxx`,verdict 为 pass/fail(阈值 0.5),**非 skipped**。
- 段 2 跑分:judge_overall 有真实数值,分数曲线含 judge 贡献。
- 段 3-5:契约演化、A/B、跨族正常。

**Pass 判据**:τ 显示真实数值(非 skipped),无 `[LLM] call failed` 警告。**注意:会产生 LLM 计费调用(~24 次校准 + judge fan-out)。**

---

## E. MCP server 手测(可选)

**命令**
```bash
npm run mcp:serve
```
进程阻塞在 stdio 等待 JSON-RPC。另开终端或用管道发消息:

```bash
# initialize
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | npm run mcp:serve
```

**预期**:stdout 返回 `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"crucible-mcp","version":"0.2.0"},...}}`。

**可用工具**(`tools/list`):`score_artifact` / `run_workflow` / `calibrate_judge` / `evolve_contract` / `ab_compare`。

**Pass 判据**:initialize + tools/list 返回合法 JSON-RPC;`score_artifact` 喂一个 artifact JSON 能返回分数报告。

---

## F. 降级安全网(可选,验证不崩)

**命令**
```bash
# 临时清掉 key(只影响当前 shell,不改 .env)
unset OPENAI_API_KEY
OPENAI_API_KEY= npx tsx src/demo.ts
```

**预期**:打印 `[LLM] OPENAI_API_KEY missing, judge will use neutral 0.5`;demo 仍跑完三段,golden 分 > buggy 分,迭代曲线正常。

**Pass 判据**:不 crash,judge_overall 显示 N/A 或 0.5,workflow 完整跑完。

---

## 常见坑

| 坑 | 现象 | 对策 |
|---|---|---|
| `.npmrc include=dev` 被改 | `tsx`/`vitest` 找不到 | 保留 `.npmrc`;shell 里 `NODE_ENV=production` 时它是装 devDeps 的关键 |
| `demo.ts` 不加载 .env | 直接 `npx tsx src/demo.ts` 读不到 key | 已修复:demo.ts 现与 demo-html/p1 一致地自加载 .env |
| better-sqlite3 native binding | `require('better-sqlite3')` 抛错 | `npm rebuild better-sqlite3`;缺编译工具链则装 build tools |
| 降级模式 τ=skipped | 误判为故障 | 设计内行为;τ 需真实 LLM(见 D) |
| `npm test` 慢/卡 | e2e 写 proposal 文件 | 正常;e2e 的 beforeEach 会清 `contracts/proposals/` |

## 风险提示

- `.env` 含**明文 API key**(gitignore 未提交,但本机盘上)。共享机器/仓库前请轮换该 key。
- 架构为**永久 adapter 模式,不 fork BigSet**(见 `docs/decisions/bigset-fork-evaluation.md`)。启动**无需** clone BigSet、无需 Convex/Next、无需采集 API key。
