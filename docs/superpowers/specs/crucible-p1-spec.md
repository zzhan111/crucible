# Crucible P1 Spec — 闭环

> P0 已完成(119 tests, QA 92/100, 5 验收达成)。
> 本 spec 定义 P1 全量范围(9 项 + 依赖顺序),作为 P1 plan 的输入。
> PRD §9 P1 交付物:分数上升曲线 + 跨族 go/no-go。抓手:20+ 迭代版本 + 3 个真实 bug + 本报告。

---

## 1. P1 Goal

把 P0(契约内核 + 确定性打分 + 降级 demo)升级为完整闭环:真实 LLM judge + 校准 + 契约自演化(Contract-Author 修订 + Curator 合并 + Human Gate)+ champion-challenger A/B + 情报表跨族探针。P1 完成后,demo 从"降级 neutral 0.5"升级为"真实 LLM 打分 + 契约自动进化 + 跨族可复用"。

## 2. P1 范围(9 项,按依赖顺序)

### 2.1 LLM provider 切换(基础设施,全 P1 依赖)

- 从 `@openrouter/ai-sdk-provider` 换到 `@ai-sdk/openai`(支持 baseURL,兼容任意 OpenAI 格式 endpoint)
- `.env` 配置:`OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL`
- 改 `src/llm/client.ts`:用 `createOpenAI({ baseURL })` 替换 `createOpenRouter`
- 降级保留:无 key 仍返回 null + 警告
- 测试:有 key 时真实调 LLM 验证返回字符串;无 key 降级不变

**依赖:无(先做,后续全依赖真实 LLM)**

### 2.2 state_mutex 相邻节点互斥(技术债,demo 真实性)

- 升级 `makeStateMutex`:从"同节点互斥"到"相邻节点互斥,除非中间有 clearing transition(switch/buffer)"
- 统一 clearing 概念:和 `no_duplicate_state` 的 CLEARING_TYPES 共用
- 重做 `hk3dayBuggy` fixture:bug 贴近 q-traveller §7 真实场景(先寄存后出发,分两个相邻节点)
- 调整验收测试断言(违规数/位置可能变)
- 测试:相邻节点互斥正/反例 + clearing 豁免

**依赖:无(独立改谓词)**

### 2.3 冻结黄金集构造 + 人工标注(judge 校准的前置)

- 从 q-traveller 种子取 8 个工件(香港 3 + 云南 3 + 防城港 2,覆盖不同质量)
- 用 AskUserQuestion pairwise comparison 做人工排序(~17 轮,每轮 10 秒)
- 排序维度:整体感受(综合时间/动线/记忆点/餐饮/来源)
- 产出:`golden/human-ranking.jsonl`(工件 ID 列表按优劣排序)
- 冻结:永不进 few-shot,只用于回归校准

**依赖:2.1(需要 LLM 才能跑 judge 对比)——但标注本身不依赖 LLM,可以先做**

### 2.4 judge 校准(真实 LLM + Kendall τ)

- 用真实 LLM(2.1 配置)跑 8 个黄金工件的 3 个 judge rubric
- 计算 judge 排序(按 final_score)与人类排序(2.3)的 Kendall τ
- 阈值:τ > 0.5 算"可接受",τ > 0.7 算"良好"(PRD §6:专家间一致性当上限)
- 如果 τ < 0.5,调 judge prompt(加 few-shot 例子 / 改评分维度描述)
- 产出:`golden/calibration-report.json`(τ 值 + 每个 judge 维度的一致性)

**依赖:2.1(LLM provider)+ 2.3(黄金集)**

### 2.5 Contract-Author LLM 修订(契约自演化第 1 环)

- 升级 `contractAuthorRead` → `contractAuthorRevise`:读现有 Contract + Curator 新颖度提议 → LLM 生成修订 diff(加字段/加约束/调权重)
- 修订 diff 格式:`ContractPatch`(类似 ArtifactPatch,但作用于 Contract YAML)
- LLM prompt:输入现有 Contract YAML + 新颖度提议,输出修订后的 Contract YAML(或 diff)
- 不自动应用:输出修订提案,交 Human Gate 审批
- 测试:LLM 生成 diff 格式校验 + 无 API key 降级(返回空 diff)

**依赖:2.1(LLM provider)**

### 2.6 Curator 自动合并 + Human Gate(契约自演化第 2 环)

- Curator 检测新颖度 → 提议扩张(已有,P0)
- 新增:Contract-Author 生成修订 diff(2.5)→ Human Gate 审批
- Human Gate 实现:AskUserQuestion 展示 diff 摘要,用户选"批准/拒绝/修改"
- 批准 → applyContractPatch → Contract 版本号 +1 → git commit
- 拒绝 → 记录拒绝原因 → 存入 `contracts/rejected-proposals/`
- 测试:Human Gate 审批流程 + 合并后 Contract 版本号更新

**依赖:2.5(Contract-Author 修订)+ 2.2(state_mutex 升级后契约更完整)**

### 2.7 champion-challenger A/B(循环论证三锚之一)

- 同时跑两套 Contract(champion = 当前版,challenger = 修订版)
- 对同一组工件打分,比较 final_score 分布
- challenger 如果在黄金集上 τ 更高 → 升级为新 champion
- challenger 如果更差 → 保留 champion,challenger 存档
- 实现:`runABComparison(champion, challenger, goldenSet)` → ABResult
- 测试:A/B 对比 + 升级/保留逻辑

**依赖:2.4(judge 校准,τ 计算)+ 2.6(Contract 版本化)**

### 2.8 情报表探针(P1 核心交付物,跨族 go/no-go)

- 用 BigSet 深度调研报告(PRD 里的竞品表)当工件
- 写情报表族 Contract YAML:`contracts/intel-table-v1.yaml`
  - artifact_family: `table`(已在 schema 支持)
  - fields: `competitor_name / feature / pricing / source / source_trust / last_verified`
  - hard_constraints: `no_empty_source` / `pricing_format` / `no_duplicate_competitor`
  - rubric: `coverage` / `freshness` / `source_trust`(deterministic)
- 写情报表 fixture:从 BigSet 报告提取 3-5 行竞品数据(含 1-2 个 bug:缺 source / 定价过期)
- 跑 Scorer + Critic + Curator 全流程
- **go/no-go 判定**:如果同一套 DSL(字段+约束+rubric 结构)能跨族使用 → go;如果需要方言(不同 schema 结构)→ 记录 OQ-13 决议,留 P2
- 产出:`contracts/intel-table-v1.yaml` + fixture + 探针报告(go/no-go + 发现)

**依赖:2.6(契约演化闭环,探针可能触发契约扩张)+ 2.1(真实 LLM judge)**

### 2.9 剩余技术债清理

- **compiler code_predicate.impl 动态加载**:用 `isolated-vm` 或 `vm2` 沙箱,让 Contract 能引用外部谓词实现(eng-review A3)
- **workflow pre-patch score 只跑确定性**:Critic 只读 violations,pre-patch 不跑 judge,省一半 LLM 调用(eng-review C3)
- **agents dead code 清理**:judge.ts 的 `judgeFanOut` 和 registry.ts 的 `createAgentRegistry` 在 P0 降级模式下未被调用。要么删除,要么加测试
- **Contract YAML 跨版本兼容性测试**:加新字段/删 optional 字段的 forward/backward compat 测试(eng-review T3)
- **Mastra 升级评估**:调研 @mastra/core 最新版是否修了 peer dep 问题。如果能跑,恢复 Studio 可观测;如果不能,保持 SimpleAgent + 记录

**依赖:2.1-2.8 完成后(技术债清理放最后,避免和功能开发冲突)**

## 3. P1 验收标准

### 3.1 分数上升曲线(PRD §9 P1 交付物)
- 真实 LLM judge(非 neutral 0.5)参与打分
- v1 → v2 → v3 分数严格递增(或非递减 + 至少一轮提升)
- 迭代至少 3 轮,最终违规 = 0

### 3.2 judge 校准通过
- Kendall τ > 0.5(judge 排序 vs 人类排序)
- 校准报告含每个 judge 维度的 τ 值

### 3.3 契约自演化闭环
- Contract-Author 生成修订 diff
- Human Gate 审批(AskUserQuestion)
- 批准后 Contract 版本号 +1 + git commit
- 至少完成 1 次契约演化(从 v1 → v2)

### 3.4 champion-challenger A/B
- 至少跑 1 次 A/B 对比
- 有明确的升级/保留决定

### 3.5 跨族 go/no-go
- 情报表族 Contract YAML 存在 + 能跑 Scorer
- 情报表 fixture 的 bug 被抓出
- go/no-go 决议记录(含 OQ-13 结论)

### 3.6 技术债清理
- state_mutex 相邻节点互斥(2.2)
- compiler code_predicate 动态加载(2.9)
- workflow 重复 score 优化(2.9)
- agents dead code 清理(2.9)
- Contract 兼容性测试(2.9)

## 4. P1 技术栈变更

- 移除:`@openrouter/ai-sdk-provider`
- 新增:`@ai-sdk/openai`(Vercel AI SDK 的 OpenAI provider,支持 baseURL)
- 可能新增:`isolated-vm` 或 `vm2`(code_predicate 沙箱,2.9)
- 保持:`ai`@6.x, `yaml`, `zod`, `vitest`, `tsx`

## 5. P1 不做(留 P2+)

- 采集层(fork BigSet / TinyFish API)
- MCP server 封装
- 缓存层 / 分级延迟
- UI / 前端(P1 仍 CLI + HTML 报告)
- 数据库
- Mastra Studio UI(P1 评估是否升级,不升级则保持日志)
- DSL 开放标准草案(P2)
- 多租户 / ToB on-prem(P4)

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM provider 切换暴露接口差异 | 先跑 2.1 验证真实 LLM 能调通,再继续 |
| 黄金集人工标注依赖用户时间 | AskUserQuestion pairwise,~3 分钟,提前预约 |
| judge τ < 0.5 需多轮调 prompt | 预留 prompt 调优迭代,最多 3 轮 |
| 情报表探针触发 DSL 方言 | OQ-13 go/no-go:如果断裂,记录决议留 P2,不强行修 |
| champion-challenger 架构改动 | 复用现有 workflow,加 A/B 对比层,不重写 |
| Curator 合并 Contract schema 冲突 | ContractPatch 用最小 diff 格式(加字段/调权重),不改 schema 结构 |
| isolated-vm 沙箱安全风险 | 如果评估风险高,P1 跳过 code_predicate 动态加载,留 P2 |
| Mastra 升级仍不可用 | 保持 SimpleAgent,P2 再试 |
