import { z } from "zod";

export const knowledgeGapStatusSchema = z.enum(["open", "resolved"]);
export const knowledgeGapFilterSchema = z.enum(["open", "resolved", "all"]);

export const resolveKnowledgeGapInputSchema = z.object({
  note: z.string().trim().min(5).max(2000),
  memory_ids: z.array(z.string().trim().min(1)).min(1).max(20),
});

export const reopenKnowledgeGapInputSchema = z.object({
  note: z.string().trim().min(5).max(2000),
});

export const updateKnowledgeGapInputSchema = z.discriminatedUnion("action", [
  resolveKnowledgeGapInputSchema.extend({ action: z.literal("resolve") }),
  reopenKnowledgeGapInputSchema.extend({ action: z.literal("reopen") }),
]);

export const knowledgeGapEventSchema = z.object({
  action: z.enum(["resolve", "reopen"]),
  note: z.string(),
  memory_ids: z.array(z.string()),
  actor: z.string(),
  created_at: z.string(),
});

export const knowledgeGapSchema = z.object({
  id: z.string(),
  question: z.string(),
  reason: z.string(),
  times_asked: z.number().int().positive(),
  first_asked_at: z.string(),
  last_asked_at: z.string(),
  status: knowledgeGapStatusSchema,
  history: z.array(knowledgeGapEventSchema),
});

export type KnowledgeGap = z.infer<typeof knowledgeGapSchema>;
export type KnowledgeGapFilter = z.infer<typeof knowledgeGapFilterSchema>;
export type UpdateKnowledgeGapInput = z.infer<typeof updateKnowledgeGapInputSchema>;
