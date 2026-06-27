import { describe, it, expect } from 'vitest';
import {
  ROLE_PERMISSIONS,
  hasPermission,
  assertPermission,
  PermissionDeniedError,
  SYSTEM_ACTOR,
  type Role,
  type Permission,
} from '../../src/auth/rbac.js';

describe('P4.2 §2 RBAC 权限层', () => {
  describe('ROLE_PERMISSIONS 矩阵', () => {
    it('admin 持有全部 4 权限', () => {
      expect(ROLE_PERMISSIONS.admin).toHaveLength(4);
      expect(ROLE_PERMISSIONS.admin).toContain('approve:contract');
    });
    it('approver 持有 approve:contract + view:audit,不能评分/跑 workflow', () => {
      expect(ROLE_PERMISSIONS.approver).toContain('approve:contract');
      expect(ROLE_PERMISSIONS.approver).toContain('view:audit');
      expect(ROLE_PERMISSIONS.approver).not.toContain('score:artifact');
      expect(ROLE_PERMISSIONS.approver).not.toContain('run:workflow');
    });
    it('author 持有 score/run/view,不能审批契约', () => {
      expect(ROLE_PERMISSIONS.author).toContain('score:artifact');
      expect(ROLE_PERMISSIONS.author).toContain('run:workflow');
      expect(ROLE_PERMISSIONS.author).not.toContain('approve:contract');
    });
    it('viewer 只读审计', () => {
      expect(ROLE_PERMISSIONS.viewer).toEqual(['view:audit']);
    });
    it('关键约束:approve:contract 仅 admin + approver 持有', () => {
      const canApprove = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter(r =>
        ROLE_PERMISSIONS[r].includes('approve:contract')
      );
      expect(canApprove.sort()).toEqual(['admin', 'approver']);
    });
  });

  describe('hasPermission', () => {
    it('有权限返回 true', () => {
      expect(hasPermission('admin', 'score:artifact')).toBe(true);
      expect(hasPermission('approver', 'approve:contract')).toBe(true);
    });
    it('无权限返回 false', () => {
      expect(hasPermission('viewer', 'score:artifact')).toBe(false);
      expect(hasPermission('author', 'approve:contract')).toBe(false);
    });
  });

  describe('assertPermission', () => {
    it('有权限时不抛', () => {
      expect(() => assertPermission({ id: 'u1', role: 'approver' }, 'approve:contract')).not.toThrow();
    });
    it('无权限时抛 PermissionDeniedError,带 actor/role/permission 信息', () => {
      const actor = { id: 'analyst1', role: 'author' as Role };
      try {
        assertPermission(actor, 'approve:contract' as Permission);
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(PermissionDeniedError);
        const err = e as PermissionDeniedError;
        expect(err.actorId).toBe('analyst1');
        expect(err.role).toBe('author');
        expect(err.permission).toBe('approve:contract');
        expect(err.message).toContain('analyst1');
        expect(err.message).toContain('approve:contract');
      }
    });
    it('viewer 调 score:artifact 被拒', () => {
      expect(() => assertPermission({ id: 'auditor', role: 'viewer' }, 'score:artifact')).toThrow(PermissionDeniedError);
    });
  });

  describe('SYSTEM_ACTOR', () => {
    it('默认 system/admin(向后兼容,全权)', () => {
      expect(SYSTEM_ACTOR.id).toBe('system');
      expect(SYSTEM_ACTOR.role).toBe('admin');
      expect(() => assertPermission(SYSTEM_ACTOR, 'approve:contract')).not.toThrow();
    });
  });
});
