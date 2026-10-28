"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ORGANIZATION_SECRET_NAMES, type ManagedOrganization, type OrganizationSettings } from "@/core/organization-settings";
import { signInPath } from "@/core/public-url";

const SECRET_LABELS = {
  google_client_secret: "Google client secret",
  oidc_client_secret: "OpenID Connect client secret",
  github_app_private_key: "GitHub App private key",
  github_app_token: "GitHub installation token",
};

function repositoriesFromText(value: string): OrganizationSettings["repositories"] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    if (line.startsWith("github://")) {
      const match = /^github:\/\/([^/]+)\/([^/]+)$/.exec(line);
      if (!match) throw new Error("Use github://owner/repository for GitHub connections.");
      return { provider: "github", owner: match[1], repository: match[2] };
    }
    if (!line.startsWith("/")) throw new Error("Use an absolute server path for a local repository.");
    return { provider: "local", root: line };
  });
}

function OrganisationForm({ organisation, onSaved }: { organisation?: ManagedOrganization; onSaved: (value: ManagedOrganization) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inheritDomains, setInheritDomains] = useState(organisation?.settings.allowed_domains === undefined);
  const settings = organisation?.settings;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const value = (name: string) => String(form.get(name) ?? "").trim();
      const list = (name: string) => value(name).split(",").map((item) => item.trim()).filter(Boolean);
      const oidcUrl = value("oidc_url");
      const updatedSettings: OrganizationSettings = {
        allowed_domains: inheritDomains ? undefined : list("domains"),
        application_name: value("application_name") || undefined,
        application_aliases: list("aliases"),
        security_contact: value("security_contact") || undefined,
        repositories: repositoriesFromText(value("repositories")).map((repository) => {
          const existing = settings?.repositories.find((item) => item.provider === "local" && repository.provider === "local" && item.root === repository.root);
          return existing ?? repository;
        }),
        google_client_id: value("google_client_id") || undefined,
        github_app_id: value("github_app_id") || undefined,
        oidc: oidcUrl ? { discovery_url: oidcUrl, client_id: value("oidc_client_id") } : undefined,
      };
      const secrets = Object.fromEntries(ORGANIZATION_SECRET_NAMES.flatMap<[string, string | null]>((name) => {
        if (form.get(`clear_${name}`)) return [[name, null]];
        return value(name) ? [[name, value(name)]] : [];
      }));
      const response = await fetch(organisation ? `/api/instance/organizations/${organisation.slug}` : "/api/instance/organizations", {
        method: organisation ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: value("name"), settings: updatedSettings, secrets,
          ...(!organisation ? { slug: value("slug"), first_admin_email: value("email") } : {}),
        }),
      });
      const result = await response.json() as { organization?: ManagedOrganization; error?: string };
      if (!response.ok || !result.organization) throw new Error(result.error || "The organisation could not be saved.");
      onSaved(result.organization);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The organisation could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 px-6 pb-8">
      <fieldset disabled={saving} className="space-y-4">
        <label className="block space-y-2 text-sm font-medium">Name<Input name="name" required maxLength={120} defaultValue={organisation?.name} /></label>
        {!organisation ? <>
          <label className="block space-y-2 text-sm font-medium">URL identifier<Input name="slug" required pattern="[a-z0-9][a-z0-9-]{0,62}" maxLength={63} placeholder="northstar" /></label>
          <label className="block space-y-2 text-sm font-medium">First administrator email<Input name="email" required type="email" /></label>
          <p className="text-sm text-muted-foreground">This exact address becomes the first organisation administrator after verified Google sign-in. Share the sign-in link after creating the organisation; Spur does not send an email.</p>
        </> : <p className="text-sm text-muted-foreground">First administrator: {organisation.first_admin_email}</p>}
      </fieldset>
      <fieldset disabled={saving} className="space-y-4 border-t pt-5">
        <legend className="text-sm font-semibold">Organisation settings</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inheritDomains} onChange={(event) => setInheritDomains(event.target.checked)} />Use instance email-domain policy</label>
        {!inheritDomains ? <label className="block space-y-2 text-sm font-medium">Allowed email domains<Input name="domains" defaultValue={settings?.allowed_domains?.join(", ")} placeholder="northstar.example, partner.example" /><span className="block text-xs font-normal text-muted-foreground">An empty list allows any verified email to request access. Membership still needs approval.</span></label> : null}
        <label className="block space-y-2 text-sm font-medium">Preferred product name<Input name="application_name" defaultValue={settings?.application_name} placeholder="Use instance default" /></label>
        <label className="block space-y-2 text-sm font-medium">Search aliases<Input name="aliases" defaultValue={settings?.application_aliases?.join(", ")} placeholder="Separate aliases with commas" /></label>
        <label className="block space-y-2 text-sm font-medium">Security contact<Input name="security_contact" maxLength={120} defaultValue={settings?.security_contact} placeholder="Use instance default" /></label>
        <label className="block space-y-2 text-sm font-medium">Repositories<Textarea name="repositories" rows={4} defaultValue={settings?.repositories.map((item) => item.provider === "local" ? item.root : `github://${item.owner}/${item.repository}`).join("\n")} placeholder="github://owner/repository" /><span className="block text-xs font-normal text-muted-foreground">One GitHub connection or absolute server path per line. Leave empty for memory-only use. Repositories are read-only; local paths must be mounted on the server.</span></label>
      </fieldset>
      <details className="border-t pt-5">
        <summary className="cursor-pointer text-sm font-semibold">Sign-in and encrypted credentials</summary>
        <fieldset disabled={saving} className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">Blank secrets are kept. Replacements are encrypted using the instance encryption key and are never returned to the browser.</p>
          <label className="block space-y-2 text-sm font-medium">Google client ID<Input name="google_client_id" defaultValue={settings?.google_client_id} placeholder="Use instance sign-in" /></label>
          <label className="block space-y-2 text-sm font-medium">GitHub App ID<Input name="github_app_id" defaultValue={settings?.github_app_id} inputMode="numeric" /></label>
          <p className="text-xs text-muted-foreground">Generic OpenID Connect (OIDC) sign-in is planned for phase 3. These two settings are stored now but do not enable it.</p>
          <label className="block space-y-2 text-sm font-medium">OIDC discovery URL<Input name="oidc_url" type="url" defaultValue={settings?.oidc?.discovery_url} /></label>
          <label className="block space-y-2 text-sm font-medium">OIDC client ID<Input name="oidc_client_id" defaultValue={settings?.oidc?.client_id} /></label>
          {ORGANIZATION_SECRET_NAMES.map((name) => <div key={name} className="space-y-2">
            <label className="block space-y-2 text-sm font-medium">{SECRET_LABELS[name]}
              {name === "github_app_private_key"
                ? <Textarea name={name} autoComplete="off" rows={3} placeholder="Paste replacement key" />
                : <Input name={name} type="password" autoComplete="new-password" placeholder="Keep existing secret" />}
            </label>
            {organisation?.configured_secrets.includes(name) ? <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" name={`clear_${name}`} />Remove stored credential</label> : <p className="text-xs text-muted-foreground">No organisation credential stored.</p>}
          </div>)}
        </fieldset>
      </details>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : organisation ? "Save changes" : "Create organisation"}</Button>
    </form>
  );
}

export function OrganizationAdmin({ initialOrganizations }: { initialOrganizations: ManagedOrganization[] }) {
  const [organisations, setOrganisations] = useState(initialOrganizations);
  const [editing, setEditing] = useState<ManagedOrganization | "new" | null>(null);
  const [notice, setNotice] = useState("");

  async function copyInvitation(organisation: ManagedOrganization) {
    try {
      await navigator.clipboard.writeText(new URL(signInPath(organisation.slug, `/o/${organisation.slug}/model`), window.location.origin).href);
      setNotice(`Sign-in link copied. Share it with ${organisation.first_admin_email}. No email has been sent.`);
    } catch {
      setNotice("Copy failed. Use the first administrator sign-in link and copy its address.");
    }
  }

  return (
    <main className="min-h-svh bg-background px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
        <Link href="/organizations" className="text-xl font-semibold tracking-tight">Spur</Link>
        <Button asChild variant="ghost"><Link href="/organizations">Your organisations</Link></Button>
      </header>
      <section className="py-8" aria-labelledby="instance-organisations-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 id="instance-organisations-title" className="text-2xl font-semibold tracking-tight">Manage organisations</h1><p className="mt-2 text-sm text-muted-foreground">Instance administration. Organisation knowledge and membership remain separate.</p></div>
          <Button onClick={() => setEditing("new")}>Create organisation</Button>
        </div>
        {notice ? <p role="status" className="mt-5 text-sm">{notice}</p> : null}
        <ul className="mt-8 divide-y border-y">
          {organisations.map((organisation) => <li key={organisation.slug} className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div><h2 className="font-medium">{organisation.name}</h2><p className="mt-1 text-sm text-muted-foreground">{organisation.slug} · {organisation.first_admin_email}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="ghost" size="sm"><a href={signInPath(organisation.slug, `/o/${organisation.slug}/model`)}>First administrator sign-in</a></Button>
              <Button variant="ghost" size="sm" onClick={() => void copyInvitation(organisation)}>Copy sign-in link</Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(organisation)} aria-label={`Edit ${organisation.name}`}>Edit settings</Button>
            </div>
          </li>)}
        </ul>
        {!organisations.length ? <p className="py-6 text-sm text-muted-foreground">No organisations yet. Create one and share its sign-in link with the first administrator.</p> : null}
      </section>
      <Sheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="shrink-0 px-6 pb-2 pt-6"><SheetTitle>{editing === "new" ? "Create organisation" : "Edit organisation"}</SheetTitle><SheetDescription>Settings apply only to this organisation.</SheetDescription></SheetHeader>
          {editing ? <OrganisationForm key={editing === "new" ? "new" : editing.slug} organisation={editing === "new" ? undefined : editing} onSaved={(organisation) => {
            setOrganisations((current) => [...current.filter((item) => item.slug !== organisation.slug), organisation].sort((left, right) => left.name.localeCompare(right.name)));
            setEditing(null);
            setNotice(`${organisation.name} saved.`);
          }} /> : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
