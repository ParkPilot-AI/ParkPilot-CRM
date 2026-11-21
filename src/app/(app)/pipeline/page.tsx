import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { LeadCard } from "@/components/crm/lead-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { getCurrentPark, getTeam, nameOf } from "@/lib/crm/context";
import { STAGES } from "@/lib/crm/labels";
import { createClient } from "@/lib/supabase/server";
import { roleAtLeast } from "@/lib/workspace/roles";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const ctx = await getCurrentPark();
  const { view } = await searchParams;
  const mine = view === "mine";
  const team = await getTeam(ctx.workspace.id);
  const db = (await createClient()).schema("crm");

  let query = db
    .from("leads")
    .select(
      "id, stage, source, stage_changed_at, interest, part_exchange, assigned_to, person:people(first_name, last_name, email, phone)",
    )
    .eq("park_id", ctx.park.id)
    .eq("outcome", "open")
    .neq("stage", "closed_sale")
    .order("stage_changed_at", { ascending: true })
    .limit(500);
  if (mine) query = query.eq("assigned_to", ctx.userId);
  const { data: leads } = await query;

  const columns = STAGES.filter((s) => s.key !== "closed_sale").map((s) => ({
    ...s,
    leads: (leads ?? []).filter((l) => l.stage === s.key),
  }));

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Open leads at this park, oldest first in each stage. Sold leads move to Owners."
        actions={
          roleAtLeast(ctx.role, "editor") ? (
            <Button asChild>
              <Link href="/leads/new">
                <Plus aria-hidden /> New lead
              </Link>
            </Button>
          ) : null
        }
      />
      <div
        className="mb-4 inline-flex rounded-md border p-0.5 text-sm"
        role="group"
        aria-label="Show"
      >
        {[
          { href: "/pipeline", label: "Everyone", active: !mine },
          { href: "/pipeline?view=mine", label: "Mine", active: mine },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 font-medium",
              t.active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible">
        {columns.map((col, i) => (
          <section
            key={col.key}
            aria-labelledby={`col-${col.key}`}
            className="w-[82vw] max-w-sm shrink-0 snap-start sm:w-80 lg:w-auto lg:max-w-none"
          >
            <header className="mb-3 border-t-2 border-accent pt-2">
              <h2
                id={`col-${col.key}`}
                className="flex items-baseline justify-between text-sm font-semibold"
              >
                <span>
                  <span className="mr-1 tabular-nums text-muted-foreground">0{i + 1}</span>{" "}
                  {col.label}
                </span>
                <span className="tabular-nums text-muted-foreground">{col.leads.length}</span>
              </h2>
            </header>
            <div className="grid gap-2">
              {col.leads.length ? (
                col.leads.map((l) => (
                  <LeadCard
                    key={l.id}
                    lead={{
                      ...l,
                      assignedName: l.assigned_to ? nameOf(team, l.assigned_to) : null,
                    }}
                  />
                ))
              ) : (
                <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No leads here
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
