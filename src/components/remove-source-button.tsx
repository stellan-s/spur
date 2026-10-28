"use client";

import { useRef, useState } from "react";
import { LoaderCircle, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Source } from "@/core/memory-types";

export function RemoveSourceButton({ source, organization, onRemoved }: {
  source: Source;
  organization: string;
  onRemoved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-spur-organization": organization },
        body: JSON.stringify({ id: source.id }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Source could not be removed.");
      }
      await onRemoved();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Source could not be removed. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => {
      if (pending.current) return;
      setError(null);
      setOpen(next);
    }}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${source.name}`}>
          <Unplug aria-hidden="true" /> Remove
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full p-6 sm:max-w-md" closeLabel="Cancel source removal">
        <SheetHeader className="pr-6">
          <SheetTitle>Remove source?</SheetTitle>
          <SheetDescription>
            Disconnect <strong className="font-medium text-foreground">{source.name}</strong> from this organization.
            Spur will stop using it for code searches and new modelling runs.
          </SheetDescription>
        </SheetHeader>
        <p className="text-sm text-muted-foreground">
          Your repository, existing catalog items, relationships, and saved evidence will not be deleted.
        </p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={saving} onClick={() => void remove()}>
            {saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Unplug aria-hidden="true" />}
            {saving ? "Removing…" : "Remove source"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
