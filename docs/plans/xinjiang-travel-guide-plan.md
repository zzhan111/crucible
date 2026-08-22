# 新疆游玩攻略生成 — Implementation Plan

> **For Hermes:** 用 crucible 引擎（契约驱动合成）生成新疆游玩攻略。信源 = 网络攻略 + 小红书笔记。
> **执行方式:** 逐 Task 主动推进（proactive drive-through），阻塞才问。

**Goal:** 用 crucible 引擎（`runCrucibleWorkflow` 3 轮迭代 + `travel-sequence` 契约族）从真实信源（网络 + 小红书）生成一份可执行、可评分、有出处的北疆环线 7 天游玩攻略。**出发地 = 石河子市 144 兵团**（行程闭环回到出发地）。

**Architecture:** 复用现有 sequence 契约族（不新建 DSL）→ 小红书/网络数据经 travel-adapter 结构化 → 组装 v1 buggy artifact（故意留真实违规）→ scorer/critic/curator 迭代提分 → 输出最终攻略 markdown + 分数曲线。

**Tech Stack:** TypeScript (crucible-dev worktree)、bb-browser xiaohongshu adapter（search/post-detail）、web_search + web_extract、vitest 验证。

**Worktree:** `D:\Apps\traveller.crucible-dev`（分支 `crucible/p4.6-intel-deepen`，95 commits，最完整）

---

## Task 0: 环境验证

**Objective:** 确认引擎可跑 + bb-browser 小红书通道可用。

**Step 1:** 验证引擎测试绿
```bash
cd /d/Apps/traveller.crucible-dev
npx vitest run 2>&1 | tail -5   # 期望: 602 passed
npx tsc --noEmit                # 期望: clean
```

**Step 2:** 验证 bb-browser daemon + xiaohongshu adapter
```bash
# daemon 若未跑: 按 bb-browser-mcp-troubleshoot skill 启动
curl -s http://127.0.0.1:<daemon_port>/status
# 试搜: site xiaohongshu/search, 关键词 "新疆旅游攻略"
# 期望: 返回笔记列表 (title/author/likes/url)
```
**阻塞点:** 若小红书需扫码登录且无法自动完成 → **stop and report**（记忆规则：扫码登录墙 = 停下报告，不硬闯）。

**Step 3:** 验证 web 信源通道
```bash
# web_search "北疆环线 7天 攻略 马蜂窝" → web_extract 攻略页
# 期望: 能拿到攻略正文 (景点/天数/交通/预算)
```

---

## Task 1: 信源采集脚本（collect-sources.py）

**Objective:** 写单一采集脚本（小红书 + 网络双通道），可被 cron 重复调用。**采集 = 确定性操作，走纯脚本（no_agent cron），不耗 LLM token。**

**Files:**
- Create: `scripts/collect-sources.py`（Python urllib 直连 daemon REST，记忆规则：不走 bash heredoc / 不依赖 MCP 工具）
- Create: `data/archive/`（每 tick 输出 `<YYYYMMDD_HHMMSS>_xhs.jsonl` + `_web.jsonl`）
- Create: `data/seen_ids.json`（全局去重，append-only set）
- Create: `data/sources-master.jsonl`（去重合并的**统一信源库**，Task 4 引擎直接消费）

**Step 1:** 小红书通道 — 对 daemon REST `POST /command {id, action, args}` 调 `xiaohongshu/search`（关键词矩阵 `新疆旅游攻略 北疆环线 喀纳斯 伊犁 独库公路 新疆美食 避坑`）→ 高赞笔记（likes ≥ 200）→ `xiaohongshu/post-detail` 拉正文 → 结构化 segment（time_block/action/duration_min/route/cost/tips）
**Step 2:** 网络通道 — **不用 web_search（Tavily 401 风险）**：curl 固定攻略站 URL 列表（马蜂窝/携程/穷游新疆攻略页 + 官方门票/交通页）→ 提取路线/价格/开放时间；兜底 DuckDuckGo HTML 搜索 `curl 'https://html.duckduckgo.com/html/?q=...'`
**Step 3:** 每 tick 行为：追加 archive → 按 note_id/url 去重写 sources-master.jsonl → stdout 输出摘要
**Step 4:** 退出码规范（skill 标准）：`0=ok, 1=daemon 未跑/无数据, 2=rate-limited(下 tick 重试), 3=其他错误`
**Step 5:** 手动端到端验证 — `python scripts/collect-sources.py` 跑一次，`wc -l data/sources-master.jsonl` ≥ 5 条，抽查正文非空（**cron 挂载前必须先手动验证，skill 铁律**）

---

## Task 2: 定时任务挂载 + 数据积累

**Objective:** 把采集脚本挂成 cron，每天自动抓信源积累数据。

**Step 1:** 创建 cron job（no_agent=True，纯脚本零 token）：
- `schedule: every 24h`（旅游攻略数据日更足够；频率过高易触发小红书风控）
- `script: D:\Apps\traveller.xinjiang-travel\scripts\collect-sources.py`
- `deliver: local`（默认；stdout 非空才投递摘要，空 = 静默）
- `no_agent: true`
- 阻塞点：daemon 未跑 → 脚本退出码 1 报告，不假装成功

**Step 2:** 挂载后观察 1-2 个 tick：`cronjob list` 看 last_status；读 cron output 目录验证 archive 有新文件
**Step 3:** 数据积累 ≥ 2 个 tick 后（或手动补跑一次凑够量）→ 解锁 Task 4（fixture 组装，数据来自 sources-master.jsonl）

**cron 设计规格（写进 job prompt/注释）:**

| 项 | 值 | 理由 |
|---|---|---|
| 层 | Layer 1 raw collector | 上游 rate-limited（小红书反爬）+ 浏览器自动化慢 |
| cadence | `every 24h` | 攻略数据非高频；防风控 |
| 模式 | no_agent 纯脚本 | 确定性操作，零 LLM token，失败靠退出码 |
| 落盘 | `data/archive/<ts>_{xhs,web}.jsonl` + `sources-master.jsonl` | archive 可追溯，master 是引擎统一输入 |
| 去重 | `seen_ids.json`（按 note_id/url） | 防静默重复（记忆教训：commit 前 grep -c 验证） |
| 退出码 | 0/1/2/3 | 0=ok 1=daemon down 2=rate-limit 3=err |
| Layer 2 | **引擎迭代是手动触发的一次性执行**（Task 5） | 数据够了才跑，不需要高频报告层 |

---

## Task 3: 攻略契约（xinjiang-travel-v1.yaml）

**Objective:** 新建新疆场景契约，复用 sequence 族 DSL，不动现有契约。

**Files:**
- Create: `contracts/xinjiang-travel-v1.yaml`
- 参考: `contracts/travel-sequence-v1.yaml`（字段/约束逐字复用）

**Step 1:** 复制 travel-sequence-v1.yaml 结构：
- `artifact_family: sequence`（不变）
- fields 逐字复用（time_block/action/route/duration_min/node_type/elasticity/cost/source/source_trust/state）
- hard_constraints 复用 4 谓词：continuity / state_mutex / time_budget / no_duplicate_state
  - `time_budget`: daily_available_minutes 改 **840**（新疆景点间车程长，留自驾余量）
  - `state_mutex`: 复用 `[luggage_drop, depart_from_hotel]` + 新增 `[checked_in, in_transit]`（独库/喀纳斯住宿与移动互斥）
- rubric 微调：routing 0.25 / memorability 0.20 / dining_fit 0.10（新疆以景区为主，美食权重降）/ cost_fit 0.15 / source_trust 0.30（**信源可信度是本场景核心，权重上调**）

**Step 2:** 验证契约可编译:
```bash
npx tsx -e "import {loadContract} from './src/contract/validate.js'; const c=loadContract('./contracts/xinjiang-travel-v1.yaml'); console.log('OK', c.artifact_family)"
```
期望: `OK sequence`（schema 校验过，权重和 = 1.0）。

---

## Task 4: 组装 v1 artifact（初稿 + 埋真实违规）

**Objective:** 把采集数据拼成 7 天行程 artifact，故意留 2-3 个真实违规（时间超预算 / 缺 transit / 重复 state），让引擎抓。

**Files:**
- Create: `src/fixtures/xinjiang-7day-v1.ts`（数据来自 Task 1-2 采集结果，不是手写编造）

**Step 1:** 从 raw 数据合成 7 天行程（**锚点 = 石河子 144 团出发/返回**，两条候选环线，采集后按信源丰富度定稿）：
- 候选 A（北线喀纳斯环线，顺路性最好）：D1 144团 → 乌尔禾魔鬼城 → 布尔津 → D2-3 喀纳斯/禾木 → D4 五彩滩 → 乌尔禾 → D5 独山子 → 独库北段 → 那拉提 → D6 那拉提/巴音布鲁克 → D7 经独库返回 144团
- 候选 B（伊犁小环线）：D1 144团 → 独山子 → 独库北段 → 乔尔玛 → 那拉提 → D2-4 那拉提/巴音布鲁克/唐布拉 → D5 赛里木湖 → D6 精河/奎屯 → D7 返 144团
- 交通节点按真实车程标注（144团 → 乌鲁木齐 ~2.5h、144团 → 独山子 ~1.5h 等），官方交通信源优先
**Step 2:** 每条 node 带真实 `source` + `source_trust`（小红书笔记 0.6-0.85，官方 1.0）
**Step 3:** 故意埋违规（与 hk-3day-buggy 同手法）：
- 某天 sum(duration_min) > 840（车程低估）
- 相邻两节点缺 transit（喀纳斯湖 → 禾木 直接跳）
- `state` 连续重复（两节点都 in_transit 无 clearing）
**Step 4:** 验证 — `npx tsx` 打印 artifact，确认 nodes 数组结构合法。

---

## Task 5: 引擎迭代脚本（run-xinjiang-travel.ts）

**Objective:** 仿 `scripts/run-intel-monitor.ts` 写新疆攻略迭代入口。

**Files:**
- Create: `scripts/run-xinjiang-travel.ts`

**Step 1:** 骨架（照抄 intel-monitor 模式）：
```ts
const contract = loadContract('contracts/xinjiang-travel-v1.yaml');
const baseScorer = compileContract(contract);
// v1 → runCrucibleWorkflow 3 轮迭代 → v3
```
**Step 2:** 用 `runCrucibleWorkflow({artifact: xinjiangV1, contract, baseScorer, artifactId: 'xinjiang-7day-v1', knownStates, minImprovement: 0})` 强制跑满 3 轮（分数曲线完整）
**Step 3:** 每轮输出：final_score / 违规数 / patch 数 / 新颖状态
**Step 4:** 验证 — `npm run xinjiang:travel`（package.json 加 script）跑通，分数 v1 < v2 < v3 单调上升。

---

## Task 6: 输出最终攻略（markdown）

**Objective:** 把 v3 finalArtifact 渲染成人类可读攻略。

**Files:**
- Create: `docs/xinjiang-travel-guide.md`（生成器 `scripts/render-xinjiang-guide.ts`，仿 demo-html 渲染逻辑）

**Step 1:** 渲染 v3 artifact → markdown：
- 7 天行程表（time_block / action / route / duration / cost / node_type）
- 每日预算小计 + 总预算区间
- 信源标注（每节点尾部 `— 来源: 小红书@xxx / 官方`）
- 避坑清单（从采集数据 tips 聚合）
**Step 2:** 验证 — 攻略每节点都有 source 标注，时间总和不超 daily_available_minutes。

---

## Task 7: 验收 + 报告

**Objective:** 端到端验收，向用户汇报。

**Step 1:** 汇总指标：v1→v3 分数、违规清零情况、信源数量（小红书 N 篇 + 网络 M 份）、judge 模式（真实 LLM or mock）
**Step 2:** 抽查 3 个节点 vs 原始信源（一致性核对，用户数据质量高标准：**不臆造，每条可溯源**）
**Step 3:** 提交（若用户确认）：worktree 内开分支 commit，PR 走 traveller 仓库规则
**Step 4:** 汇报：攻略文件路径 + 分数曲线 + 信源清单

---

## 关键决策（默认值，可改）

| 决策点 | 默认 | 理由 |
|---|---|---|
| 范围 | **北疆环线 7 天，石河子 144 团出发/返回闭环** | 用户指定出发地；144团 → 独山子仅 ~1.5h，独库北段顺路；候选 A/B 按信源定稿 |
| 契约 | **新建** xinjiang-travel-v1.yaml（复制 sequence 族） | 不动 travel-sequence（surgical）；source_trust 权重 0.30 突出信源 |
| judge | 有 OPENAI_API_KEY 走真实 LLM；无则 mock fallback | 引擎降级哲学，永不 crash |
| 小红书 | daemon REST 直连 + xiaohongshu/search + post-detail | 扫码登录墙 = stop and report |
| 违规埋点 | 3 个真实型违规（时间/transit/state） | 与 hk-3day-buggy 同手法，引擎可抓 |
| 提交 | 计划阶段不 commit；执行完用户确认后开分支 | Git 工作流规则 |

## 验收标准（Definition of Done）

- [ ] `npx vitest run` 全绿（新增脚本不破坏 602 测试）
- [ ] v1→v3 分数单调上升，hard 违规数下降
- [ ] 攻略每条节点有 source + source_trust，抽查 3 条与信源一致
- [ ] 小红书 ≥ 5 篇笔记 + 网络 ≥ 2 份攻略进入数据
- [ ] `docs/xinjiang-travel-guide.md` 生成，7 天行程 + 预算 + 避坑
