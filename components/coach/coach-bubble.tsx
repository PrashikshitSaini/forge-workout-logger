"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { buildCoachContext } from "@/lib/coach-context";
import { DATA_CHANGED_EVENT } from "@/lib/events";
import {
  INSIGHT_ANGLES,
  INSIGHT_CACHE_KEY,
  INSIGHT_TTL_MINUTES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const insightPrompt = (angle: string) =>
  `Give me ONE sharp, confident one-liner about my training right now — a little edge is good. ` +
  `Angle: ${angle}. Use my real numbers from context. Max 24 words, a single line, no greeting, no emoji.`;

export function CoachBubble() {
  const pathname = usePathname();
  const compactForWorkout = pathname === "/";
  const [sb] = useState(() => createSupabaseBrowserClient());
  const [insight, setInsight] = useState<string | null>(null);
  const [teaserVisible, setTeaserVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const contextRef = useRef<string | null>(null);
  const dismissedRef = useRef(false);

  const getContext = useCallback(async () => {
    if (contextRef.current == null) contextRef.current = await buildCoachContext(sb);
    return contextRef.current;
  }, [sb]);

  const callAI = useCallback(
    async (msgs: ChatMessage[]) => {
      const context = await getContext();
      // The dialogue must open with a user turn. Drop the seeded insight (a
      // leading assistant message) so providers that enforce alternation accept it.
      const outgoing = [...msgs];
      while (outgoing.length && outgoing[0].role === "assistant") outgoing.shift();
      if (outgoing.length === 0) throw new Error("Nothing to send.");
      const res = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing, context }),
      });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "The coach is unavailable.");
      return json.text ?? "";
    },
    [getContext],
  );

  const generateInsight = useCallback(async () => {
    try {
      const angle = INSIGHT_ANGLES[Math.floor(Math.random() * INSIGHT_ANGLES.length)];
      const text = await callAI([{ role: "user", content: insightPrompt(angle) }]);
      setInsight(text);
      if (!dismissedRef.current) setTeaserVisible(true);
      try {
        localStorage.setItem(INSIGHT_CACHE_KEY, JSON.stringify({ text, ts: Date.now() }));
      } catch {
        /* storage unavailable — fine, we just won't cache */
      }
    } catch (err) {
      // Surface the real reason so insight failures are diagnosable instead of silent.
      console.error("Coach insight failed:", err);
    }
  }, [callAI]);

  // Initial insight: use a fresh cached one, else generate — deferred so it
  // never blocks first paint.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(INSIGHT_CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { text?: string; ts?: number };
          if (cached.text && cached.ts && Date.now() - cached.ts < INSIGHT_TTL_MINUTES * 60_000) {
            setInsight(cached.text);
            setTeaserVisible(true);
            return;
          }
        }
      } catch {
        /* ignore malformed cache */
      }
      void generateInsight();
    }, 1500);
    return () => clearTimeout(timer);
  }, [generateInsight]);

  // Refresh when a workout is saved.
  useEffect(() => {
    const onChange = () => {
      contextRef.current = null;
      try {
        localStorage.removeItem(INSIGHT_CACHE_KEY);
      } catch {
        /* ignore */
      }
      void generateInsight();
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, [generateInsight]);

  function openChat() {
    setTeaserVisible(false);
    setOpen(true);
    setMessages((prev) =>
      prev.length ? prev : insight ? [{ role: "assistant", content: insight }] : [],
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const reply = await callAI(next);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("Coach chat failed:", err);
      const msg =
        err instanceof Error && /not configured/i.test(err.message)
          ? "Add your OpenRouter key (OPENROUTER_API_KEY) to enable the coach."
          : `Coach error: ${err instanceof Error ? err.message : "unknown error"}`;
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 z-40 mx-auto max-w-md px-4 pb-2",
          compactForWorkout ? "bottom-40" : "bottom-20",
        )}
      >
        {teaserVisible && insight && !compactForWorkout ? (
          <div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-accent/40 bg-surface p-3 shadow-lg">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" />
            <button type="button" onClick={openChat} className="min-w-0 flex-1 text-left">
              <span className="block text-sm leading-snug">{insight}</span>
              <span className="mt-1 block text-xs text-accent">Tap to chat →</span>
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                dismissedRef.current = true;
                setTeaserVisible(false);
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openChat}
              aria-label="Open coach"
              className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full border border-border bg-surface text-accent shadow-lg hover:bg-surface-2"
            >
              <Sparkles size={20} />
            </button>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Coach"
        footer={
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask about training or nutrition…"
              className="h-11 flex-1 rounded-lg border border-border bg-surface-2 px-3 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground disabled:opacity-50"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted">
              <MessageCircle size={24} />
              <p className="text-sm">Ask about your lifts, recovery, meals, or what to do next.</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
                  m.role === "user"
                    ? "ml-auto bg-accent text-accent-foreground"
                    : "mr-auto bg-surface-2 text-foreground",
                )}
              >
                {m.content}
              </div>
            ))
          )}
          {sending ? (
            <div className="mr-auto flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> thinking…
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
