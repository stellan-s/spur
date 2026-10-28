import { z } from "zod";

export const ismsControlInputSchema = z.object({
  reference: z.string().trim().min(1).max(80),
  framework: z.string().trim().min(2).max(160),
  framework_version: z.string().trim().max(80).default(""),
  title: z.string().trim().min(3).max(200),
  objective: z.string().trim().min(5).max(4_000),
  owner: z.string().trim().min(2).max(160),
  applicability: z.enum(["undecided", "applicable", "not_applicable"]).default("undecided"),
  applicability_rationale: z.string().trim().max(2_000).default(""),
  implementation_status: z.enum(["not_assessed", "planned", "implemented"]).default("not_assessed"),
  review_due_on: z.iso.date().nullable().default(null),
  evidence_references: z.array(z.object({
    label: z.string().trim().min(2).max(160),
    locator: z.string().trim().min(2).max(2_000),
  })).max(30).default([]),
  linked_memory_ids: z.array(z.string().regex(/^mem_[a-zA-Z0-9_-]+$/)).max(100).default([]),
}).superRefine((input, context) => {
  if (input.applicability === "not_applicable" && !input.applicability_rationale) {
    context.addIssue({ code: "custom", path: ["applicability_rationale"], message: "Explain why this control is not applicable." });
  }
  if (new Set(input.linked_memory_ids).size !== input.linked_memory_ids.length) {
    context.addIssue({ code: "custom", path: ["linked_memory_ids"], message: "A model object can only be linked once." });
  }
});

export const ismsControlSchema = ismsControlInputSchema.safeExtend({
  id: z.string(),
  governance_state: z.enum(["draft", "approved", "archived"]),
  version: z.number().int().positive(),
  actor: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  archived_at: z.string().nullable(),
});

export const ismsControlRevisionSchema = z.object({
  control_id: z.string(),
  version: z.number().int().positive(),
  control: ismsControlSchema,
  actor: z.string(),
  changed_at: z.string(),
});

export type IsmsControlInput = z.infer<typeof ismsControlInputSchema>;
export type IsmsControl = z.infer<typeof ismsControlSchema>;
export type IsmsControlRevision = z.infer<typeof ismsControlRevisionSchema>;
