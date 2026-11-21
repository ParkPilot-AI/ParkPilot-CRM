import { BottomNav, Sidebar } from "@/components/shell/sidebar";
import { ParkSwitcher } from "@/components/shell/park-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoMark } from "@/components/brand/logo";
import { getCurrentPark } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await getCurrentPark();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", ctx.userId)
    .maybeSingle();

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:h-16 sm:px-6">
          <LogoMark size={20} className="md:hidden" />
          <ParkSwitcher
            park={{ id: ctx.park.id, name: ctx.park.name }}
            parks={ctx.parks.map((p) => ({ id: p.id, name: p.name }))}
            workspace={{ id: ctx.workspace.id, name: ctx.workspace.name }}
            workspaces={ctx.memberships.map((m) => ({
              id: m.workspace.id,
              name: m.workspace.name,
            }))}
          />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu email={ctx.email} name={profile?.full_name ?? null} />
          </div>
        </header>
        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-10 md:pt-8"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
