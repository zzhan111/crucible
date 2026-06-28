import { z } from 'zod';

const FieldType = z.enum(['string', 'integer', 'number', 'enum', 'string[]']);

const FieldDef = z.object({
  name: z.string(),
  type: FieldType,
  required: z.boolean(),
  values: z.array(z.string()).optional(),
});

const HardConstraint = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('declarative'),
    rule: z.string().optional(),
    mutex: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('code_predicate'),
    impl: z.string(),
    threshold: z.number().optional(),
  }),
]);

const RubricMode = z.enum(['deterministic', 'judge', 'proxy+judge']);

const RubricEntry = z.object({
  dim: z.string(),
  weight: z.number().min(0).max(1),
  mode: RubricMode,
});

const Calibration = z.object({
  frozen_golden_set: z.string(),
  metric: z.enum(['kendall_tau', 'spearman_rho']),
  human_ceiling: z.string().optional(),
});

export const ContractSchema = z.object({
  artifact_family: z.enum(['sequence', 'table', 'brief', 'roster', 'financial']),
  fields: z.array(FieldDef),
  hard_constraints: z.array(HardConstraint),
  rubric: z.array(RubricEntry)
    .refine(entries => {
      const sum = entries.reduce((acc, e) => acc + e.weight, 0);
      return Math.abs(sum - 1.0) < 0.001;
    }, 'rubric weights must sum to 1.0'),
  calibration: Calibration,
});

export type Contract = z.infer<typeof ContractSchema>;
export type FieldDef = z.infer<typeof FieldDef>;
export type HardConstraint = z.infer<typeof HardConstraint>;
export type RubricEntry = z.infer<typeof RubricEntry>;
