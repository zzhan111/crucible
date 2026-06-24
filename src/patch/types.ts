import type { ArtifactNode } from '../predicates/types.js';

export type ArtifactPatch =
  | { type: 'insert'; after_index: number; node: ArtifactNode; reason: string }
  | { type: 'replace'; index: number; node: ArtifactNode; reason: string }
  | { type: 'delete'; index: number; reason: string }
  | { type: 'update_field'; index: number; field: string; value: unknown; reason: string };
