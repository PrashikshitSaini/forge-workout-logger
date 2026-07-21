import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { BottomNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui/toast";
import { CoachBubble } from "@/components/coach/coach-bubble";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <main className="flex-1 pb-28">{children}</main>
      <CoachBubble />
      <BottomNav />
      <Toaster />
    </div>
  );
}
