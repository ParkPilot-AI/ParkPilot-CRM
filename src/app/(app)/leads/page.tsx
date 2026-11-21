import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { OutcomeBadge } from "@/components/crm/stage";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { getCurrentPark, getTeam, nameOf } from "@/lib/crm/context";
import { ago, displayPhone, personName } from "@/lib/crm/format";
import { SOURCE_LABEL, STAGES } from "@/lib/crm/labels";
import { createClient } from "@/lib/supabase/server";
import { stageSchema } from "@/lib/validation/crm";
import { roleAtLeast } from "@/lib/workspace/roles";

export const metadata: Metadata = { title: "Leads" };

const PAGE = 50;

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const ctx = await getCurrentPark();
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  // Strip characters PostgREST treats as syntax in filters.
  const q = str(sp.q)
    .replace(/[,()*%\\]/g, " ")
    .trim()
    .slice(0, 80);
  const status = ["open", "won", "lost", "all"].includes(str(sp.status)) ? str(sp.status) : "open";
  const stage = stageSchema.safeParse(sp.stage).data;
  const mine = str(sp.mine) === "1";
  const page = Math.max(0, Number(str(sp.page)) || 0);

  const team = await getTeam(ctx.workspace.id);
  const db = (await createClient()).schema("crm");
  let query = db
    .from("leads")
    .select(
      "id, stage, outcome, source, created_at, assigned_to, person:people!inner(first_name, last_name, email, phone)",
      { count: "exact" },
    )
    .eq("park_id", ctx.park.id)
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (status !== "all") query = query.eq("outcome", status as "open" | "won" | "lost");
  if (stage) query = query.eq("stage", stage);
  if (mine) query = query.eq("assigned_to", ctx.userId);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const terms = [
      `first_name.ilike.*${q}*`,
      `last_name.ilike.*${q}*`,
      `email.ilike.*${q}*`,
      ...(digits.length >= 4 ? [`phone.ilike.*${digits.replace(/^0/, "")}*`] : []),
    ];
    query = query.or(terms.join(","), { referencedTable: "person" });
  }
  const { data: leads, count } = await query;
  const total = count ?? 0;
  const params = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (status !== "open") u.set("status", status);
    if (stage) u.set("stage", stage);
    if (mine) u.set("mine", "1");
    for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
    return `/leads?${u.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description={`${total} ${total === 1 ? "lead" : "leads"}`}
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
      <form className="mb-6 grid gap-2 sm:grid-cols-[1fr_150px_150px_auto_auto]" role="search">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Name, email or phone"
            aria-label="Search leads"
            className="pl-9"
          />
        </div>
        <NativeSelect name="status" defaultValue={status} aria-label="Status">
          <option value="open">Open</option>
          <option value="won">Sold</option>
          <option value="lost">Lost</option>
          <option value="all">All</option>
        </NativeSelect>
        <NativeSelect name="stage" defaultValue={stage ?? ""} aria-label="Stage">
          <option value="">Any stage</option>
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
        <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm">
          <input
            type="checkbox"
            name="mine"
            value="1"
            defaultChecked={mine}
            className="accent-[var(--accent)]"
          />{" "}
          Mine
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {leads?.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {leads.map((l) => (
            <li key={l.id}>
              <Link
                href={`/leads/${l.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{personName(l.person)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[l.person?.email, displayPhone(l.person?.phone)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {SOURCE_LABEL[l.source]} · {ago(l.created_at)} · {nameOf(team, l.assigned_to)}
                </span>
                <OutcomeBadge outcome={l.outcome} stage={l.stage} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={q || stage || mine || status !== "open" ? "No leads match" : "No leads yet"}
          description={
            q || stage || mine || status !== "open"
              ? "Try a different search or filter."
              : "Leads from your website, ParkPilot AI and your team will appear here. Add a phone call or walk-in with New lead."
          }
        />
      )}
      {total > PAGE ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          {page > 0 ? (
            <Link href={params({ page: page - 1 })} className="font-medium hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}
          </span>
          {(page + 1) * PAGE < total ? (
            <Link href={params({ page: page + 1 })} className="font-medium hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
