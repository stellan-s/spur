import { z } from "zod";

import type { MemoryObject } from "./memory-types";

export const productDocumentTypeSchema = z.enum(["prd", "spec"]);
export type ProductDocumentType = z.infer<typeof productDocumentTypeSchema>;

export const productDocumentInputSchema = z.object({
  document_type: productDocumentTypeSchema,
  title: z.string().trim().min(3).max(160),
  content: z.string().trim().min(5).max(12_000).describe("Markdown. Select sections and visuals that fit the document. PRDs commonly cover problem, goals, scope, requirements and open questions, with optional acceptance criteria, Definition of Done, diagrams and images. Specs commonly cover design, interfaces, data, failure handling, testing and rollout."),
  related_ids: z.array(z.string().startsWith("mem_")).max(30).default([]),
  sensitivity: z.literal("restricted").optional(),
});

export type ProductDocumentInput = z.infer<typeof productDocumentInputSchema>;

export function productDocumentType(item: Pick<MemoryObject, "metadata">): ProductDocumentType | null {
  const parsed = productDocumentTypeSchema.safeParse(item.metadata.document_type);
  return parsed.success ? parsed.data : null;
}

export function isProductDocument(item: Pick<MemoryObject, "metadata">): boolean {
  return productDocumentType(item) !== null;
}

export function productDocumentPath(organizationSlug: string, id: string): string {
  return `/o/${encodeURIComponent(organizationSlug)}/documents/${encodeURIComponent(id)}`;
}
