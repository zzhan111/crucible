/** 一个工件节点,对应 Contract fields 的一行 */
export interface ArtifactNode {
  [fieldName: string]: unknown;
}

/** 完整工件 = 节点序列 */
export interface Artifact {
  family: 'sequence' | 'table' | 'brief' | 'roster' | 'financial';
  nodes: ArtifactNode[];
  metadata?: {
    day?: number;
    daily_available_minutes?: number;
    budget?: { min: number; max: number };
    // P4.3 财务尽调 vertical 元数据
    fiscal_year?: number;
    currency?: string;
    audit_status?: 'audited' | 'reviewed' | 'unaudited';
    company?: string;
    // Live Env v1: constraint_update 事件写入的运行时阈值覆盖。
    // Scorer 评估硬约束时优先读这里,fallback 到 contract 原阈值。
    // env 关闭时此字段 undefined,行为等同 P3.5。
    runtime_overrides?: Record<string, unknown>;
  };
}

/** 硬约束违规 */
export interface Violation {
  constraint_id: string;
  severity: 'hard' | 'soft';
  message: string;
  location: {
    node_index?: number;
    node_index_end?: number;
    field?: string;
  };
  fix_hint?: string;
}

/** 确定性谓词:纯函数,artifact → violations */
export type Predicate = (artifact: Artifact) => Violation[];

// 注:P0 不定义 PredicateFactory——compiler 用 switch(c.id) 硬编码映射,不需要工厂。
// P1 升级 code_predicate.impl 动态加载时再定义 factory 接口(eng-review C2)。
