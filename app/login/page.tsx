"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { APP_TAGLINE } from "@/lib/constants";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (otpError) throw otpError;
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send the link.");
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Logo size={36} className="mb-2" />
        <p className="mb-8 text-sm text-muted">{APP_TAGLINE}</p>

        {!configured ? (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted">
            <p className="mb-1 font-semibold text-warning">Not configured yet</p>
            Add <code className="tabular">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="tabular">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
            <code className="tabular">.env.local</code>, then restart. See{" "}
            <code className="tabular">README.md</code>.
          </div>
        ) : status === "sent" ? (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm">
            <p className="mb-1 flex items-center gap-2 font-semibold text-accent">
              <Mail size={16} /> Check your email
            </p>
            <p className="text-muted">
              We sent a sign-in link to <span className="text-foreground">{email}</span>. Open it on
              this device to finish.
            </p>
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={status === "sending"}>
              {status === "sending" ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Sending…
                </>
              ) : (
                "Send sign-in link"
              )}
            </Button>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <p className="pt-1 text-center text-xs text-muted-foreground">
              No password. We email you a one-tap link.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
