/**
 * MCP Server(P2 §2.3): 轻量级 JSON-RPC 2.0 over stdio。
 *
 * 不依赖外部 MCP SDK(npm 安装超时),直接实现协议:
 * - stdio 传输: 每行一个 JSON-RPC 消息
 * - 支持: initialize, tools/list, tools/call
 * - 兼容 MCP 客户端(Claude Desktop / 任意 MCP client)
 *
 * 用法:
 *   npx tsx src/mcp/server.ts
 *
 * 测试方式: 通过 stdin 发送 JSON-RPC 消息,读取 stdout 响应。
 */
import { createInterface } from 'node:readline';
import { MCP_TOOLS, findTool } from './tools.js';

const SERVER_NAME = 'crucible-mcp';
const SERVER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function makeResponse(id: string | number | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? 0, result };
}

function makeError(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? 0, error: { code, message } };
}

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id;

  switch (req.method) {
    case 'initialize':
      return makeResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: { tools: {} },
      });

    case 'initialized':
      // notification, no response
      return null;

    case 'tools/list':
      return makeResponse(id, {
        tools: MCP_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = String(params.name ?? '');
      const tool = findTool(toolName);
      if (!tool) {
        return makeError(id, -32601, `unknown tool: ${toolName}`);
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.handler(args);
        return makeResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        return makeError(id, -32603, `tool execution failed: ${(e as Error).message}`);
      }
    }

    default:
      return makeError(id, -32601, `unknown method: ${req.method}`);
  }
}

/**
 * startMcpServer: 启动 stdio MCP server。
 * 读取 stdin 行(JSON-RPC),写 stdout 行(响应)。
 */
export async function startMcpServer(): Promise<void> {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch {
      const resp = makeError(0, -32700, 'parse error');
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    const resp = await handleRequest(req);
    if (resp) {
      process.stdout.write(JSON.stringify(resp) + '\n');
    }
  });

  // 保持进程运行
  return new Promise<void>((resolve) => {
    rl.on('close', () => resolve());
  });
}

// 直接运行入口: 仅当显式指定 CRUCIBLE_MCP_SERVER=1 时启动(避免 import 时误触发)
if (process.env.CRUCIBLE_MCP_SERVER === '1') {
  startMcpServer().catch(e => {
    console.error('[MCP] server error:', e);
    process.exit(1);
  });
}
