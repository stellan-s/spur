import type { MemoryKind } from "@/core/memory-types";

type CatalogExplanation = {
  label: string;
  question: string;
  meaning: string;
  purpose: string;
  example: string;
  reference: { title: string; href: string };
};

export const CATALOG_EXPLANATIONS = {
  application: {
    label: "Application",
    question: "Which product are we talking about?",
    meaning: "A named software product that supports users or business work. In Spur, a connected repository can have a managed application entry.",
    purpose: "Give knowledge a recognizable product context and connect the product to its supporting systems and capabilities. A repository is a source of evidence, not necessarily the whole application.",
    example: "Customer portal: the product customers use to manage their projects.",
    reference: { title: "Application software", href: "https://en.wikipedia.org/wiki/Application_software" },
  },
  system: {
    label: "System",
    question: "What provides the technical support?",
    meaning: "In Spur, a software service, platform, database, or other technical component with a distinct responsibility. An application may depend on several systems.",
    purpose: "Make responsibilities and dependencies visible, including external services. Use an application for the product context and systems for its technical landscape; do not duplicate the same thing without a reason.",
    example: "Billing service: calculates charges and maintains billing records for the customer portal.",
    reference: { title: "Information system", href: "https://en.wikipedia.org/wiki/Information_system" },
  },
  integration: {
    label: "Integration",
    question: "How do systems exchange information?",
    meaning: "A connection through which systems exchange data or coordinate work.",
    purpose: "Document the exchange as something with its own purpose, direction, and dependencies. A simple relationship can say two systems are connected; an integration explains that connection.",
    example: "Customer synchronisation: sends updated contact details from the portal to the customer relationship management (CRM) system.",
    reference: { title: "System integration", href: "https://en.wikipedia.org/wiki/System_integration" },
  },
  information: {
    label: "Information",
    question: "What information does the business need?",
    meaning: "A meaningful body of information that people or systems create, use, or share. It can span several entities or appear in a report or document.",
    purpose: "Describe business meaning before focusing on individual fields. Use Information for an overview such as spending history, and Entity for a structured concept with attributes and relationships.",
    example: "Campaign performance: spend, reach, and outcomes brought together to assess results.",
    reference: { title: "Information model", href: "https://en.wikipedia.org/wiki/Information_model" },
  },
  entity: {
    label: "Entity",
    question: "Which things do we keep information about?",
    meaning: "A distinct business or data concept with attributes and relationships. A Spur entity usually describes a type of thing, not one individual record.",
    purpose: "Agree what a concept means, how to identify it, and where its information is stored. Connect representations across systems without assuming that every table is a separate business concept.",
    example: "User: a person who can use a service, described by an identifier, name, and email. This is not a list of actual users.",
    reference: { title: "Entity–relationship model", href: "https://en.wikipedia.org/wiki/Entity%E2%80%93relationship_model" },
  },
  capability: {
    label: "Capability",
    question: "What can the business do?",
    meaning: "An ability that helps the organization achieve an outcome, independent of the particular screen, team, or implementation used today.",
    purpose: "Discuss business value and coverage in a stable vocabulary. Link a capability to the processes, systems, and information that support it.",
    example: "Budget management: the ability to plan, allocate, and monitor spending. It is broader than the steps for changing one budget.",
    reference: { title: "Capability management in business", href: "https://en.wikipedia.org/wiki/Capability_management_in_business" },
  },
  process: {
    label: "Process",
    question: "How does the work happen?",
    meaning: "A sequence of activities that takes an input or event to an outcome, including relevant participants and handovers.",
    purpose: "Explain how a capability is carried out and where rules or controls apply. A capability describes the ability; a process describes the work.",
    example: "Change a budget: submit a change, validate it, obtain approval when needed, and publish it.",
    reference: { title: "Business process", href: "https://en.wikipedia.org/wiki/Business_process" },
  },
  control: {
    label: "Technical control",
    question: "What safeguard is actually in place?",
    meaning: "A mechanism observed in the implementation that prevents, detects, or limits an unwanted outcome. It may support a business rule or a security objective.",
    purpose: "Connect an intended restriction to evidence of its implementation. The presence of code is not, by itself, proof that a safeguard is effective or that the organization meets a standard.",
    example: "Budget validation: a check rejects a negative budget before saving it. Sensitive security details belong in restricted knowledge.",
    reference: { title: "Security controls", href: "https://en.wikipedia.org/wiki/Security_controls" },
  },
  decision: {
    label: "Decision",
    question: "Why was this approach chosen?",
    meaning: "A recorded choice and its rationale. In Spur, decisions can concern business policy as well as technical architecture.",
    purpose: "Preserve context so future teams understand the trade-off rather than guessing from code. Record who decided and the supporting evidence; do not invent a rationale from observed behaviour.",
    example: "Use monthly budget planning to align campaign spending with the finance team's planning cycle.",
    reference: { title: "Architectural decision", href: "https://en.wikipedia.org/wiki/Architectural_decision" },
  },
  rule: {
    label: "Rule",
    question: "What condition or constraint applies?",
    meaning: "A statement that defines or constrains business behaviour, including conditions under which something is allowed or required.",
    purpose: "Make behaviour understandable without reading code. Distinguish an implemented rule inferred from code from an approved policy; link it to controls that enforce it and decisions explaining it.",
    example: "A project budget must not be negative. The rule states the constraint; budget validation is the control that enforces it.",
    reference: { title: "Business rule", href: "https://en.wikipedia.org/wiki/Business_rule" },
  },
  observation: {
    label: "Observation",
    question: "What did we notice that needs attention?",
    meaning: "In Spur, an evidence-backed finding about behaviour, a limitation, or an inconsistency. It is not automatically a rule or an approved decision.",
    purpose: "Keep findings visible without presenting them as intended policy. State what was observed, where, and what still needs checking.",
    example: "A summary screen shows a different label for the same marketing goal than the setup screen.",
    reference: { title: "Observation", href: "https://en.wikipedia.org/wiki/Observation" },
  },
} satisfies Record<MemoryKind, CatalogExplanation>;

export const MODEL_REFERENCES = {
  information: { title: "Wikipedia: Information model", href: "https://en.wikipedia.org/wiki/Information_model" },
  relationships: { title: "Wikipedia: Entity–relationship model", href: "https://en.wikipedia.org/wiki/Entity%E2%80%93relationship_model" },
  classification: { title: "Wikipedia: Data classification", href: "https://en.wikipedia.org/wiki/Data_classification_(data_management)" },
  record: { title: "Wikipedia: System of record", href: "https://en.wikipedia.org/wiki/System_of_record" },
  isms: { title: "ISO: ISO/IEC 27001 and information security management", href: "https://www.iso.org/standard/27001" },
} as const;
