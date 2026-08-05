"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

interface ExportConfig {
  configured: boolean;
  endpoint_path: string | null;
}

export function WorkoutExportSettings() {
  const [config, setConfig] = useState<ExportConfig | null>(null);
  const [password, setPassword] = useState("");
  const [rotate, setRotate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch("/api/workouts/export/config", { cache: "no-store" })
      .then(async (response) => response.ok ? (response.json() as Promise<ExportConfig>) : Promise.reject())
      .then(setConfig)
      .catch(() => toast("Couldn't load workout export settings.", "error"));
  }, []);

  async function save() {
    if (password.length < 12) {
      toast("Use a password with at least 12 characters.", "error");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/workouts/export/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, rotate_endpoint: rotate }),
      });
      const body = await response.json() as ExportConfig & { error?: string };
      if (!response.ok || !body.endpoint_path) throw new Error(body.error);
      setConfig({ configured: true, endpoint_path: body.endpoint_path });
      setPassword("");
      setRotate(false);
      toast("Workout export password saved.", "success");
    } catch {
      toast("Couldn't save workout export settings.", "error");
    } finally {
      setSaving(false);
    }
  }

  const endpoint = config?.endpoint_path && typeof window !== "undefined"
    ? `${window.location.origin}${config.endpoint_path}`
    : null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Workout export API</h2>
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex gap-3">
          <KeyRound size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="font-medium">Protected curl export</p>
            <p className="mt-1 text-xs leading-5 text-muted">Export your workout history for personal automations. Your password is stored as a one-way hash.</p>
          </div>
        </div>
        {endpoint ? <p className="break-all rounded-lg bg-background p-2 font-mono text-xs text-muted">{endpoint}</p> : null}
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config?.configured ? "New password (12+ characters)" : "Choose password (12+ characters)"} autoComplete="new-password" />
        {config?.configured ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={rotate} onChange={(event) => setRotate(event.target.checked)} />
            Rotate the endpoint URL too (invalidates the old link)
          </label>
        ) : null}
        <Button variant="secondary" className="w-full" onClick={() => void save()} disabled={saving || !config}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          {config?.configured ? "Update export password" : "Enable workout export"}
        </Button>
        {endpoint ? <p className="text-xs leading-5 text-muted">Use <code>curl -u forge:YOUR_PASSWORD &quot;{endpoint}&quot;</code>. Keep the password in your automation&apos;s secret store.</p> : null}
      </div>
    </section>
  );
}
