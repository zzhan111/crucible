# Crucible MCP — Agent 接入指南

> 本文档面向 coding agent(ZCode / Claude Code / 任意 MCP client)。读完即可:① 把 crucible MCP 接入你的工具集;② 正确调用 5 个工具;③ 理解返回结构。
>
> MCP server 源码:`src/mcp/server.ts` · 工具定义:`src/mcp/tools.ts`

## 1. MCP server 是什么

Crucible 把"契约驱动合成"引擎封装成一个 **MCP(Model Context Protocol)server**:
- **传输**:JSON-RPC 2.0 over **stdio**(每行一个 JSON 消息,stdin 读请求 / stdout 写响应)
- **协议版本**:`2024-11-05`
- **serverInfo**:`{ "name": "crucible-mcp", "version": "0.2.0" }`
- **能力**:`tools`(共 5 个工具)
- 不依赖外部 MCP SDK,直接实现协议;兼容任何 MCP 客户端

agent 接入后,可调用 crucible 对**工件(artifact)**做:打分、迭代修复、judge 校准、契约演化、A/B 对比——全在引擎内完成,无需 agent 自己实现打分逻辑。

## 2. 启动命令

MCP server 经 stdio 运行。跨平台启动方式(已封装,无需手动设 env):

```bash
node scripts/run-mcp.mjs
# 等价于:CRUCIBLE_MCP_SERVER=1 tsx src/mcp/server.ts
# npm script: npm run mcp:serve
```

`scripts/run-mcp.mjs` 是跨平台 wrapper(node 设 env + `shell:false` 调 tsx),PowerShell/CMD/Git Bash/Mac 通用。它用 `import.meta.url` 自解析项目根,**不依赖 cwd**——args 给绝对路径即可。

## 3. 接入配置

### 方式 A:项目级 `.mcp.json`(本目录已有,推荐)

crucible-dev 根目录的 `.mcp.json`:

```json
{
  "mcpServers": {
    "crucible": {
      "command": "node",
      "args": ["<crucible-dev 绝对路径>/scripts/run-mcp.mjs"],
      "env": {}
    }
  }
}
```

支持 `${CLAUDE_PROJECT_DIR}` 变量的客户端可写:

```json
{
  "mcpServers": {
    "crucible": {
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR}/scripts/run-mcp.mjs"]
    }
  }
}
```

### 方式 B:ZCode 用户级配置(`~/.zcode/cli/config.json`)

在 `mcp.servers` 下加一条:

```json
{
  "mcp": {
    "servers": {
      "crucible": {
        "type": "stdio",
        "command": "node",
        "args": ["D:/Apps/traveller.crucible-dev/scripts/run-mcp.mjs"]
      }
    }
  }
}
```

> ⚠️ 两种格式不同:项目级 `.mcp.json` 用 **`mcpServers`**(驼峰顶层),ZCode 用户级 config 用 **`mcp.servers`**(嵌套)。别混。

## 4. 协议握手(minimal client 流程)

```
1. client → server:  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"...","version":"..."}}}
   server → client:  {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"crucible-mcp","version":"0.2.0"},"capabilities":{"tools":{}}}}

2. client → server:  {"jsonrpc":"2.0","method":"notifications/initialized"}   (通知,无响应)

3. client → server:  {"jsonrpc":"2.0","id":2,"method":"tools/list"}
   server → client:  {"jsonrpc":"2.0","id":2,"result":{"tools":[ ...5 个工具... ]}}

4. client → server:  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}
   server → client:  {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"<JSON 结果>"}]}}
```

- 每行一个 JSON 消息(以 `\n` 分隔)
- `initialized` 是 notification(id 可省,无响应)
- 工具结果在 `result.content[0].text`,是 **JSON 字符串**,需再 parse

## 5. 工具清单(5 个)

### 5.1 `score_artifact` — 对工件打分

**用途**:对一个 artifact 按契约打分,返回 ScoreReport(确定性分 + judge 分)。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `artifact_json` | string | 是 | artifact 的 JSON 字符串(含 `nodes` 数组) |
| `contract_path` | string | 是 | 契约 YAML 文件路径 |

**返回**(`ScoreReport`):
```json
{
  "artifactId": "...",
  "final_score": 0.82,            // 最终分 = det*0.6 + judge*0.4
  "deterministic_score": 0.75,    // 硬约束 + 确定性 rubric
  "judge_overall": 0.92,          // LLM judge(无 key 时为 0.5,neutral)
  "violations": [                  // 硬约束违反列表
    { "rule": "continuity", "detail": "...", "severity": "error" }
  ],
  "rubric_scores": [               // 各 rubric 维度分
    { "name": "routing", "score": 0.8, "source": "proxy+judge" }
  ],
  "contract_version": "1.0.0"
}
```

### 5.2 `run_workflow` — 运行完整迭代工作流

**用途**:从 buggy artifact 出发,跑 v1→Critic 修补→v2→v3 迭代循环,返回迭代历史 + 最终工件 + 分数。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `artifact_json` | string | 是 | 起始(含 bug 的)artifact JSON |
| `contract_path` | string | 是 | 契约 YAML 路径 |
| `known_states` | string[] | 否 | 已知 state token,供 Curator 新颖度检测 |

**返回**:
```json
{
  "iterations": [                  // 每轮:分数 + 违规 + patch
    { "round": 1, "score": 0.55, "violations": [...], "patches": [...] }
  ],
  "final_artifact": { "nodes": [...] },
  "final_score": 1.0,
  "final_violations": []
}
```

### 5.3 `calibrate_judge` — judge 校准(Kendall τ)

**用途**:用黄金集对 judge 做校准,返回 Kendall τ 一致性。**无 API key 时 τ=skipped**(降级)。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `contract_path` | string | 是 | 契约 YAML 路径 |

**返回**(`CalibrationReport`):
```json
{
  "kendall_tau": 0.4286,           // τ(无 key 时为 null/0,verdict="skipped")
  "verdict": "pass",               // pass(≥0.5) / fail / skipped
  "samples": [...]
}
```
> ⚠️ 真实 τ 需要 `OPENAI_API_KEY`(见 §7)。降级模式 τ 无意义。

### 5.4 `evolve_contract` — 契约演化

**用途**:从 artifact 检测新颖 state,生成契约修订 patch(Curator 提案 + Contract-Author 修订)。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `contract_path` | string | 是 | 契约 YAML 路径 |
| `artifact_json` | string | 是 | 待检测新颖度的 artifact JSON |
| `known_states` | string[] | 否 | 已知 state token |

**返回**:
```json
{
  "proposals": [                   // Curator 检测到的新颖提案
    { "type": "new_state", "token": "beach_hiking", "rationale": "..." }
  ],
  "patches": [                     // Contract-Author 生成的修订 patch
    { "op": "add_constraint", "target": "...", "value": "..." }
  ]
}
```
> patch 需经 **Human Gate** 审批后才真正写入契约(见 `processGateDecision`)。

### 5.5 `ab_compare` — champion-challenger A/B 对比

**用途**:对比两个契约在黄金集上的表现,返回 τ 差值 + verdict。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `champion_path` | string | 是 | 冠军契约 YAML 路径 |
| `challenger_path` | string | 是 | 挑战者契约 YAML 路径 |

**返回**(`ABResult`):
```json
{
  "champion_tau": 0.42,
  "challenger_tau": 0.51,
  "delta": 0.09,
  "verdict": "promote"             // promote(挑战者更好) / retain / inconclusive
}
```

## 6. 调用示例(JSON-RPC)

### 打分
```json
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"score_artifact","arguments":{
  "artifact_json":"{\"nodes\":[{\"time_block\":\"09:00\",\"action\":\"...\",\"route\":\"A→B\",\"duration_min\":120,\"node_type\":\"transport\",\"elasticity\":\"fixed\",\"cost\":0,\"source\":\"plan\",\"source_trust\":0.9,\"state\":\"depart_from_hotel\"}]}",
  "contract_path":"contracts/travel-sequence-v1.yaml"
}}}
```

### 跑迭代工作流
```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"run_workflow","arguments":{
  "artifact_json":"<buggy artifact JSON>",
  "contract_path":"contracts/travel-sequence-v1.yaml",
  "known_states":["depart_from_hotel","luggage_drop"]
}}}
```

### 校准
```json
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"calibrate_judge","arguments":{
  "contract_path":"contracts/travel-sequence-v1.yaml"
}}}
```

## 7. LLM key 与降级

- **真实 judge / τ 校准**:需要 `OPENAI_API_KEY`(+ 可选 `OPENAI_BASE_URL`/`OPENAI_MODEL`,支持 OpenAI/DeepSeek/任意 OpenAI 兼容端点)。key 在 crucible-dev 的 `.env` 里。
- **降级模式**(无 key):judge 返回 neutral 0.5,workflow 仍跑通,但 τ=skipped、judge_overall=0.5。`score_artifact` / `run_workflow` / `evolve_contract` 在降级下仍可用(确定性部分有效),仅 `calibrate_judge` / `ab_compare` 的 τ 无意义。
- MCP server 进程**继承启动它的客户端环境**。若客户端未透传 `.env`,judge 会降级——这是正常的,不是故障。

## 8. 工件(artifact)格式

travel-sequence 族 artifact 结构(契约 `contracts/travel-sequence-v1.yaml` 定义):

```json
{
  "nodes": [
    {
      "time_block": "09:00",
      "action": "乘地铁前往中环",
      "route": "酒店→中环",
      "duration_min": 30,
      "node_type": "transport",       // enum: transport/meal/attraction/rest/shopping/luggage/transition
      "elasticity": "fixed",          // enum: fixed/flexible/buffer
      "cost": 8,
      "source": "plan",
      "source_trust": 0.9,
      "state": "depart_from_hotel"    // free-form token
    }
  ]
}
```

硬约束(违反则扣分):`continuity`(路线连续)、`state_mutex`(互斥 state 不能同现)、`time_budget`(≤960 min/天)、`no_duplicate_state`。

样例 artifact 见 `src/fixtures/`:`hk-3day-golden.ts`(满分)、`hk-3day-buggy.ts`(含 3 个 bug)。

## 9. 契约文件

- `contracts/travel-sequence-v1.yaml` — 主契约(旅游行程序列族),工具默认用它
- `contracts/intel-table-v1.yaml` — 情报表族(跨族探针用)
- 所有工具的 `*_path` 参数接受**相对 crucible-dev 根的路径**或绝对路径

## 10. 快速验证(命令行)

```bash
# 1. 握手
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' | npm run mcp:serve
# 期望: {"...serverInfo":{"name":"crucible-mcp","version":"0.2.0"}...}

# 2. 列工具
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npm run mcp:serve
# 期望: tools 数组含 5 个工具
```

## 11. 常见问题

| 现象 | 原因 | 对策 |
|---|---|---|
| τ=skipped / judge=0.5 | 无 `OPENAI_API_KEY` | 在 crucible-dev `.env` 填 key;或接受降级(确定性部分仍有效) |
| `unknown tool` | toolName 拼错 | 用 `tools/list` 确认确切名称(下划线分隔) |
| `tool execution failed: invalid artifact` | artifact_json 不是合法 JSON 或缺 `nodes` | 确保 `artifact_json` 是**字符串化的 JSON**,含 `nodes` 数组 |
| 路径找不到 | contract_path 相对路径基于 server 进程 cwd | 用绝对路径,或相对 crucible-dev 根的路径 |
| MCP 不被 agent 识别 | `.mcp.json` 格式/位置错 | 项目级用 `mcpServers`(顶层);ZCode 用户级用 `mcp.servers`(嵌套) |
