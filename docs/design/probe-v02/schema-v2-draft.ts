import { z } from 'zod';
const Field = z.object({ name: z.string(), type: z.enum(['string','integer','number','boolean','enum','string[]']), required: z.boolean(), values: z.array(z.string()).optional(), unit: z.string().optional(), origin: z.enum(['artifact','binding']).optional() }).strict();
const Cond = z.object({ field: z.string(), op: z.enum(['==','!=','<','<=','>','>=','in']), value: z.unknown() }).strict();
const Base = { id: z.string(), unless: z.array(Cond).optional(), scope: z.enum(['node','artifact']), enforcement: z.enum(['gate','penalty','lint']), penalty: z.number().min(0).max(1).optional(), rule_text: z.string(), item_ref: z.string() };
const Ratio = z.object({ ...Base, type: z.literal('primitive'), primitive: z.literal('ratio_threshold'), params: z.object({ numerator: z.string(), denominator: z.string(), op: z.enum(['<','<=','>','>=']), value: z.number(), on_zero_denominator: z.enum(['violate','pass','error']) }).strict() }).strict();
const Range = z.object({ ...Base, type: z.literal('primitive'), primitive: z.literal('range'), params: z.object({ field: z.string(), min: z.number().optional(), max: z.number().optional() }).strict() }).strict();
const Hard = z.union([Ratio, Range]);
const Band = z.object({ dim: z.string(), weight: z.number().min(0).max(1), mode: z.literal('deterministic'), primitive: z.literal('band'), params: z.object({ metric: z.object({ ratio: z.tuple([z.string(), z.string()]) }).strict(), bands: z.array(z.object({ max: z.number(), score: z.number().min(0).max(1) }).strict()).min(1), else_score: z.number().min(0).max(1) }).strict(), aggregate: z.enum(['mean','min']) }).strict();
const Share = z.object({ dim: z.string(), weight: z.number().min(0).max(1), mode: z.literal('deterministic'), primitive: z.literal('share_cap'), params: z.object({ group_by: z.string(), max_share: z.number().min(0).max(1) }).strict() }).strict();
const Judge = z.object({ dim: z.string(), weight: z.number().min(0).max(1), mode: z.literal('judge'), judge: z.object({ template: z.string(), question: z.string(), inputs: z.array(z.string()).min(1), scale: z.object({ min: z.number(), max: z.number() }).strict(), samples: z.number().int().min(1), aggregate: z.enum(['median','mean']) }).strict() }).strict();
export const ContractV2 = z.object({
  schema_version: z.literal(2),
  metadata: z.object({ contract_id: z.string(), version: z.number().int().min(1), status: z.enum(['draft','calibrating','published']), scenario_id: z.string(), spec_hash: z.string(), compiler_version: z.string(), provenance_hash: z.string(), data_snapshot: z.record(z.string()) }).strict(),
  artifact_family: z.literal('table'),
  evaluation_unit: z.enum(['artifact']),
  context: z.object({ as_of: z.literal('required'), ref_tables: z.array(z.object({ name: z.string(), key: z.string(), columns: z.record(z.enum(['string','number','integer','boolean'])) }).strict()), bindings: z.array(z.object({ field: z.string(), from: z.string(), on: z.string(), on_missing: z.enum(['error','null']) }).strict()) }).strict(),
  fields: z.array(Field).min(1),
  hard_constraints: z.array(Hard),
  rubric: z.array(z.union([Band, Share, Judge])).min(1).refine(es => Math.abs(es.reduce((a,e)=>a+e.weight,0)-1) < 1e-3, 'weights must sum to 1'),
  calibration: z.object({ golden_set_ref: z.string(), metric: z.enum(['kendall_tau_b','spearman_rho']), holdout: z.union([z.literal('none'), z.number().int().min(1)]) }).strict(),
}).strict().superRefine((c, ctx) => {
  const names = new Set(c.fields.map(f => f.name));
  const refs = (c.hard_constraints as any[]).flatMap(h => [h.params.numerator, h.params.denominator, h.params.field, ...(h.unless ?? []).map((u: any) => u.field)]).filter(Boolean);
  for (const r of refs) if (!names.has(r)) ctx.addIssue({ code: 'custom', message: `unknown field ${r}` });
});
