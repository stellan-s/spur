"use client";

import { useEffect, useState } from "react";

type Session = {
  organization: { slug: string; name: string };
  user: { display_name: string; access_status: string };
};

export default function AccessPendingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const organisation = new URLSearchParams(window.location.search).get("organization");
    fetch("/api/auth/session", {
      cache: "no-store",
      headers: organisation ? { "x-spur-organization": organisation } : {},
    })
      .then(async (response) => {
        const payload = await response.json() as Session & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Your access request could not be loaded.");
        setSession(payload);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Your access request could not be loaded."));
  }, []);

  const status = session?.user.access_status;
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-8 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">Spur access</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {status === "rejected" ? "Your request was rejected" : "Your request is waiting for approval"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error || (session
            ? `${session.user.display_name}, an administrator for ${session.organization.name} must approve your account before you can open organisation data.`
            : "Checking your request…")}
        </p>
        {status === "approved" && session ? (
          <a className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href={session.organization.slug ? `/o/${session.organization.slug}/model` : "/organizations"}>
            Open Spur
          </a>
        ) : null}
      </section>
    </main>
  );
}
