import type { MemoryKind } from "./memory-types";

// Layer order the vocabulary follows:
// capability -> process -> rule/control -> information -> entity -> data location -> system.
// Applications are source registrations outside that order and describe systems.

export const RELATIONSHIP_PREDICATES = {
  part_of: "The source is a step, sub-process or component of the target.",
  realised_by: "The target carries out the source, e.g. a capability realised by a process or an ISMS control realised by a safeguard.",
  governed_by: "A rule or control constrains or protects the source.",
  enforced_by: "A rule or control is enforced in the target system, process or control.",
  depends_on: "The source cannot work without the target.",
  uses: "The source uses the target without reading or writing its data.",
  reads: "The source reads the target entity or information.",
  writes: "The source creates, updates or deletes the target entity or information.",
  runs_in: "The source process, rule or control runs in the target system.",
  stored_in: "The source entity or information is stored in the target system.",
  derived_from: "The source information is derived from the target entity.",
  triggers: "The source starts the target process.",
  followed_by: "The target process comes after the source process.",
  from_system: "The source integration sends from the target system.",
  to_system: "The source integration delivers to the target system.",
  concerns: "The source observation is about the target.",
  contradicts: "The source observation shows the target rule, control or process does not hold.",
  refines: "The source is a more specific version of the target.",
  affects: "The source decision affects the target.",
  describes: "The source application registration describes the target system.",
  belongs_to: "Entity to entity: the source belongs to the target (many_to_one or one_to_one).",
  references: "Entity to entity: the source refers to the target without belonging to it.",
  related_to: "A plain association when no other predicate fits.",
} as const;

export type RelationshipPredicate = keyof typeof RELATIONSHIP_PREDICATES;

export const RELATIONSHIP_PREDICATE_NAMES = Object.keys(RELATIONSHIP_PREDICATES) as [
  RelationshipPredicate,
  ...RelationshipPredicate[],
];

export const ENTITY_RELATIONSHIP_PREDICATES: ReadonlySet<RelationshipPredicate> = new Set([
  "belongs_to",
  "references",
]);

// Common synonyms and inverses, so a rejection can name the predicate to use.
export const RELATIONSHIP_PREDICATE_HINTS: Record<string, string> = {
  governs: "governed_by with the endpoints swapped",
  protects: "governed_by with the endpoints swapped",
  guards: "governed_by with the endpoints swapped",
  applies_to: "governed_by with the endpoints swapped",
  constrains: "governed_by with the endpoints swapped",
  implements: "realised_by with the endpoints swapped",
  implemented_by: "enforced_by",
  implemented_in: "enforced_by",
  has_step: "part_of with the endpoints swapped",
  includes: "part_of with the endpoints swapped",
  contains: "part_of with the endpoints swapped",
  precedes: "followed_by",
  triggered_by: "triggers with the endpoints swapped",
  creates: "writes",
  updates: "writes",
  records: "writes",
  writes_to: "writes or uses",
  calls: "uses",
  performed_by: "runs_in",
  source_system: "from_system",
  target_system: "to_system",
  has: "belongs_to with the endpoints swapped, or references",
  owns: "belongs_to with the endpoints swapped",
  holds: "belongs_to with the endpoints swapped",
  bypasses: "contradicts",
  undermines: "contradicts",
  violates: "contradicts",
};

export function isRelationshipPredicate(value: string): value is RelationshipPredicate {
  return Object.hasOwn(RELATIONSHIP_PREDICATES, value);
}

// Returns a rejection reason, or null when the predicate fits the two endpoint kinds.
export function relationshipPredicateProblem(
  predicate: string,
  fromKind: MemoryKind,
  toKind: MemoryKind,
): string | null {
  if (!isRelationshipPredicate(predicate)) {
    const hint = RELATIONSHIP_PREDICATE_HINTS[predicate];
    return `Predicate ${predicate} is not in the vocabulary${hint ? `; use ${hint}` : ""}. Allowed: ${RELATIONSHIP_PREDICATE_NAMES.join(", ")}.`;
  }
  const entityPair = fromKind === "entity" && toKind === "entity";
  if (entityPair && !ENTITY_RELATIONSHIP_PREDICATES.has(predicate)) {
    return `Entity to entity relationships use belongs_to or references, not ${predicate}.`;
  }
  if (!entityPair && ENTITY_RELATIONSHIP_PREDICATES.has(predicate)) {
    return `${predicate} is only valid between two entities.`;
  }
  if (predicate === "affects" && fromKind !== "decision") {
    return "affects is only valid from a decision; observations use concerns.";
  }
  return null;
}
