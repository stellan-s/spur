"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { organization: string; returnTo: string };

export function OtpLoginForm({ organization, returnTo }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, organization: organization || undefined, return_to: returnTo || undefined }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "The login code could not be sent.");
      setStep("code");
      setMessage(`We sent a six-digit code to ${email}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The login code could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json() as { error?: string; target?: string };
      if (!response.ok || !payload.target) throw new Error(payload.error || "The login code could not be verified.");
      window.location.assign(payload.target);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The login code could not be verified.");
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <form className="mt-6 space-y-4" onSubmit={verifyCode}>
        <div>
          <label className="text-sm font-medium" htmlFor="code">Login code</label>
          <Input id="code" name="code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus className="mt-2 text-center text-lg tracking-[0.35em]" />
        </div>
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
        <Button className="w-full" type="submit" disabled={busy || code.length !== 6}>{busy ? "Signing in…" : "Sign in"}</Button>
        <Button className="w-full" type="button" variant="ghost" disabled={busy} onClick={() => { setCode(""); setStep("email"); setMessage(""); }}>Use another email or resend</Button>
      </form>
    );
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={requestCode}>
      <div>
        <label className="text-sm font-medium" htmlFor="email">Email</label>
        <Input id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus className="mt-2" />
      </div>
      {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
      <Button className="w-full" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a login code"}</Button>
    </form>
  );
}
