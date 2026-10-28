import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { CATALOG_EXPLANATIONS, MODEL_REFERENCES } from "@/lib/guide-catalog";

const linkStyle = "text-sm font-medium text-primary underline underline-offset-4 hover:no-underline";

function ReadingLink({ title, href }: { title: string; href: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={linkStyle}>{title}<span className="sr-only"> (opens in a new tab)</span></a>;
}

export function GuideModelReference({ basePath }: { basePath: string }) {
  return (
    <>
      <nav aria-label="Model reference sections" className="flex flex-wrap gap-x-6 gap-y-3 border-b py-5">
        <a href="#guide-information-model" className={linkStyle}>Information models</a>
        <a href="#guide-catalog-types" className={linkStyle}>Catalog object types</a>
        <a href="#guide-relationships" className={linkStyle}>Relationships</a>
        <a href="#guide-isms" className={linkStyle}>ISMS controls</a>
      </nav>

      <section className="scroll-mt-6 border-b py-8 sm:py-10" aria-labelledby="guide-information-model">
        <h2 id="guide-information-model" className="text-xl font-semibold tracking-tight">What is an information model?</h2>
        <div className="mt-3 max-w-4xl space-y-3 text-sm leading-6 text-muted-foreground">
          <p>An information model describes the concepts a business works with, what they mean, and how they relate. It gives people and systems a shared language: does “customer” mean a person, an organization, or a billing account?</p>
          <p>It is not just a database diagram, and it is not a copy of customer records. Start with business meaning, then connect it to the fields, tables, documents, and systems that represent it. One concept can have several technical representations.</p>
          <p>We use it to clarify ownership, find where information lives, understand dependencies, and ask consistent questions across applications. Spur connects this information model to capabilities, processes, rules, decisions, and source evidence.</p>
          <ReadingLink {...MODEL_REFERENCES.information} />
        </div>
        <h3 className="mt-6 text-base font-medium">The building blocks</h3>
        <dl className="mt-3 divide-y border-y text-sm leading-6">
          {[
            ["Entity", "A concept such as Customer, Project, or Budget."],
            ["Attribute", "A property of an entity, such as Budget amount or currency. Record its type and whether it is required, unique, or an identifier."],
            ["Relationship", "A named connection, such as Project belongs to Customer."],
            ["Cardinality", "How many things can be connected: one-to-one, one-to-many, or many-to-many."],
            ["Information classification", "How information should be handled, for example internal, confidential, or personal. Classification documents sensitivity; access permissions are configured separately."],
            ["Data location", "Where the information is stored: a system and a table, field, document, or other locator. Identify the system of record—the authoritative source—and distinguish copies or references."],
          ].map(([term, description]) => (
            <div key={term} className="grid gap-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-medium">{term}</dt>
              <dd className="max-w-4xl text-muted-foreground">{description}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <ReadingLink {...MODEL_REFERENCES.relationships} />
          <ReadingLink {...MODEL_REFERENCES.classification} />
          <ReadingLink {...MODEL_REFERENCES.record} />
        </div>
      </section>

      <section className="scroll-mt-6 border-b py-8 sm:py-10" aria-labelledby="guide-catalog-types">
        <h2 id="guide-catalog-types" className="text-xl font-semibold tracking-tight">The catalog object types: what and why</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
          These are Spur&apos;s working definitions; terminology can vary between organizations.
          Expand a type to see when to use it. All examples in this reference are illustrative,
          not claims about your applications and not saved catalog entries.
        </p>
        <div className="mt-5 divide-y border-y">
          {Object.entries(CATALOG_EXPLANATIONS).map(([kind, item]) => (
            <details key={kind} id={`guide-kind-${kind}`} className="group scroll-mt-6 py-1">
              <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md py-4 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
                <span className="flex flex-1 flex-wrap items-baseline gap-x-5 gap-y-1">
                  <span className="text-base font-medium sm:w-40">{item.label}</span>
                  <span className="text-sm text-muted-foreground">{item.question}</span>
                </span>
              </summary>
              <div className="max-w-5xl space-y-3 pb-5 pl-7 text-sm leading-6 text-muted-foreground">
                <p>{item.meaning}</p>
                <p><span className="font-medium text-foreground">Why we use it: </span>{item.purpose}</p>
                <p><span className="font-medium text-foreground">Illustrative example: </span>{item.example}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
                  <Link href={`${basePath}/model/catalog?kind=${kind}`} className={linkStyle}>Browse {item.label.toLowerCase()} objects</Link>
                  <ReadingLink title={`Wikipedia: ${item.reference.title}`} href={item.reference.href} />
                </div>
              </div>
            </details>
          ))}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          External reading explains the concepts. It is not evidence that a particular feature,
          rule, or control exists in your organization; that needs its own source and review.
        </p>
      </section>

      <section className="scroll-mt-6 border-b py-8 sm:py-10" aria-labelledby="guide-relationships">
        <h2 id="guide-relationships" className="text-xl font-semibold tracking-tight">Relationships turn a catalog into a model</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
          A relationship joins two existing objects with a named, directed connection. Read it as a sentence:
          “Change budget writes Budget.” An integration is an object describing an exchange; a relationship
          is a link between objects. Attributes belong to entities, and evidence supports claims; neither
          is an additional catalog object type.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm leading-6">
            <caption className="mb-3 text-left text-xs text-muted-foreground">Illustrative connections, not your organization&apos;s modeled facts.</caption>
            <thead className="border-y">
              <tr><th scope="col" className="px-3 py-2 font-medium">From</th><th scope="col" className="px-3 py-2 font-medium">Relationship</th><th scope="col" className="px-3 py-2 font-medium">To</th></tr>
            </thead>
            <tbody className="divide-y border-b text-muted-foreground">
              {[
                ["Project (entity)", "belongs to", "Customer (entity)"],
                ["Change budget (process)", "writes", "Budget (entity)"],
                ["Budget must not be negative (rule)", "enforced by", "Budget validation (technical control)"],
                ["Budget management (capability)", "uses", "Budget (entity)"],
              ].map(([from, predicate, to]) => (
                <tr key={from}><td className="px-3 py-3">{from}</td><td className="px-3 py-3">{predicate}</td><td className="px-3 py-3">{to}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-muted-foreground">
          The Entities map shows entities connected to other entities. The Architecture map shows connected
          applications, systems, capabilities, processes, and integrations. These are filtered views, not the
          entire catalog. Use object details for other relationships and supporting evidence.
        </p>
        <Link href={`${basePath}/model?map=entities`} className={`mt-3 inline-block ${linkStyle}`}>Explore the entity map</Link>
      </section>

      <section className="scroll-mt-6 border-b py-8 sm:py-10" aria-labelledby="guide-isms">
        <h2 id="guide-isms" className="text-xl font-semibold tracking-tight">Why ISMS controls have their own catalog</h2>
        <div className="mt-3 max-w-4xl space-y-3 text-sm leading-6 text-muted-foreground">
          <p>ISMS means Information Security Management System: the organization&apos;s approach to managing information security. A governed ISMS control records a security objective, framework reference, owner, applicability, implementation status, review date, and evidence references.</p>
          <p>A technical control records a safeguard found in an implementation. An ISMS control records how the organization governs a security requirement. Link the two when implementation evidence supports the requirement; one governed control may rely on several technical controls and human procedures.</p>
          <p>Illustrative example: a governed access-review requirement can link to role-management controls and evidence of periodic reviews. Finding a role check in code does not establish that those reviews happened. Recording or approving an ISMS control in Spur does not establish certification.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
            <Link href={`${basePath}/isms/controls`} className={linkStyle}>Open ISMS controls</Link>
            <ReadingLink {...MODEL_REFERENCES.isms} />
          </div>
        </div>
      </section>
    </>
  );
}
