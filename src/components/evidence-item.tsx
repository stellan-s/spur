"use client";

import { Check, FileCode2, FileText, ShieldCheck } from "lucide-react";

import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { Evidence } from "@/core/types";

const KIND_LABELS: Record<Evidence["kind"], string> = {
  code: "Source code",
  test: "Test evidence",
  approved_document: "Approved document",
  verification_record: "Verification record",
};

function EvidenceIcon({ kind }: { kind: Evidence["kind"] }) {
  if (kind === "code" || kind === "test") return <FileCode2 aria-hidden="true" />;
  if (kind === "verification_record") return <ShieldCheck aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}

export function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger className="rounded-md py-1 pr-1 focus-visible:ring-2 focus-visible:ring-ring">
        <TraceLine className="gap-2 py-1 text-xs">
          <TraceIcon className="[&_svg]:size-3.5">
            <EvidenceIcon kind={evidence.kind} />
          </TraceIcon>
          <TraceTitle className="font-mono">{evidence.path}</TraceTitle>
          <TraceDescription>L{evidence.start_line}–{evidence.end_line}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="ml-1.5 border-l pl-5 pt-1.5">
        <div className="flex flex-col gap-1.5 pb-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5">
            <Check className="size-3.5" aria-hidden="true" />
            {KIND_LABELS[evidence.kind]} verified
          </span>
          <span className="font-mono">{evidence.repo}</span>
        </div>
        <pre className="max-h-[360px] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-6 text-zinc-50">
          <code>
            {evidence.excerpt
              .split("\n")
              .map((line, index) => `${String(evidence.start_line + index).padStart(3)}  ${line}`)
              .join("\n")}
          </code>
        </pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
