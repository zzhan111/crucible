/**
 * P4.2 §2 — 企业内部 RBAC(轻量 actor 标识)。
 *
 * PRD v1.2 §7 禁止闭源多租户 SaaS(AGPL 决定),ToB 是 on-prem 单租户。
 * 所以这里**不建 users 表 / 不做会话** — actor 是外部传入的字符串标识,
 * 角色权限矩阵是常量表。这是"够 ToB demo 显式呈现谁有权做什么"的最小实现。
 *
 * 📌 演进路径(P4.2.5,留展望):
 *   当前 actor = { id: string, role: Role },id 由调用方传入(如 MCP client 传用户名)。
 *   完整 RBAC 将加 users 表 + 会话 token + 密码哈希,但**ROLE_PERMISSIONS 矩阵不变** —
 *   权限逻辑是稳定的,变的只是"actor 从哪来"。审计报告展望框会显式说明这条路径,
 *   让 ToB demo 对象看到落地形态。
 *
 * spec ref: PRD v1.2 §5 §6(ToB on-prem + 审计轨迹);P4.2 plan §2
 */

/** 角色:企业内部 4 种。覆盖 ToB 典型分工。 */
export type Role = 'admin' | 'author' | 'approver' | 'viewer';

/** 权限:粒度到"动作"。 */
export type Permission =
  | 'score:artifact'    // 打分
  | 'run:workflow'      // 跑迭代回路
  | 'approve:contract'  // 审批契约变更(human gate 关键)
  | 'view:audit';       // 查审计轨迹

/**
 * 角色 → 权限矩阵(常量)。
 * - admin:全权(运维/超管)
 * - approver:审批契约 + 看审计(企业合规/法务角色,不能跑 workflow 改数据)
 * - author:打分 + 跑 workflow(数据工程师/分析师,不能审批契约)
 * - viewer:只读审计(审计员/监管对接)
 *
 * 关键约束:approve:contract 仅 admin + approver 持有 — 契约变更必须人审且有权的人审。
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['score:artifact', 'run:workflow', 'approve:contract', 'view:audit'],
  approver: ['approve:contract', 'view:audit'],
  author: ['score:artifact', 'run:workflow', 'view:audit'],
  viewer: ['view:audit'],
};

/** Actor:操作者标识。id 是外部传入字符串(用户名/MCP client 标识),role 决定权限。 */
export interface Actor {
  id: string;
  role: Role;
}

/** 默认 system actor(向后兼容:P4.1 不传 actor 时用这个,admin 全权不破坏行为)。 */
export const SYSTEM_ACTOR: Actor = { id: 'system', role: 'admin' };

/** 检查某角色是否持有某权限。 */
export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** 权限被拒错误。 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly actorId: string,
    public readonly role: Role,
    public readonly permission: Permission
  ) {
    super(`权限拒绝:actor="${actorId}"(role=${role})无 ${permission} 权限`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * 断言 actor 持有权限,无权抛 PermissionDeniedError。
 * 用法:在 human-gate approve 路径调 assertPermission(approver, 'approve:contract')。
 */
export function assertPermission(actor: Actor, perm: Permission): void {
  if (!hasPermission(actor.role, perm)) {
    throw new PermissionDeniedError(actor.id, actor.role, perm);
  }
}
