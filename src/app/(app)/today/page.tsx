import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Eyebrow } from "@/components/brand/eyebrow";
import { TaskList } from "@/components/crm/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentPark, getTeam, nameOf } from "@/lib/crm/context";
import { ago, formatTime, personName } from "@/lib/crm/format";
import { SOURCE_LABEL } from "@/lib/crm/labels";
import { addDays, dayBounds, zonedDate, zonedToUtc } from "@/lib/crm/time";
import { createClient } from "@/lib/supabase/server";
import { roleAtLeast } from "@/lib/workspace/roles";

export const metadata: Metadata = { title: "Today" };

const PERSON = "person:people(first_name, last_name, email, phone)";

export default async function TodayPage() {
  const ctx = await getCurrentPark();
  const tz = ctx.park.timezone;
  const db = (await createClient()).schema("crm");
  const team = await getTeam(ctx.workspace.id);
  const { start, end } = dayBounds(new Date(), tz);
  const weekEnd = zonedToUtc(addDays(zonedDate(new Date(), tz), 7), "00:00", tz).toISOString();
  const monthStart = zonedToUtc(
    `${zonedDate(new Date(), tz).slice(0, 7)}-01`,
    "00:00",
    tz,
  ).toISOString();
  const weekAgo = new Date(new Date().getTime() - 7 * 86_400_000).toISOString();

  const [tasksRes, upcomingRes, toursRes, newLeadsRes, openCount, toursWeek, salesMonth] =
    await Promise.all([
      db
        .from("tasks")
        .select(`id, title, due_at, lead:leads(id, park_id, ${PERSON})`)
        .eq("workspace_id", ctx.workspace.id)
        .eq("assigned_to", ctx.userId)
        .is("completed_at", null)
        .or(`due_at.is.null,due_at.lt.${end}`)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(50),
      db
        .from("tasks")
        .select(`id, title, due_at, lead:leads(id, park_id, ${PERSON})`)
        .eq("workspace_id", ctx.workspace.id)
        .eq("assigned_to", ctx.userId)
        .is("completed_at", null)
        .gte("due_at", end)
        .lt("due_at", weekEnd)
        .order("due_at")
        .limit(20),
      db
        .from("tours")
        .select(`id, starts_at, ends_at, status, advisor_id, lead:leads(id, ${PERSON})`)
        .eq("park_id", ctx.park.id)
        .gte("starts_at", start)
        .lt("starts_at", end)
        .neq("status", "cancelled")
        .order("starts_at"),
      db
        .from("leads")
        .select(`id, source, created_at, assigned_to, ${PERSON}`)
        .eq("park_id", ctx.park.id)
        .eq("outcome", "open")
        .eq("stage", "enquiry")
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(8),
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("park_id", ctx.park.id)
        .eq("outcome", "open"),
      db
        .from("tours")
        .select("id", { count: "exact", head: true })
        .eq("park_id", ctx.park.id)
        .eq("status", "scheduled")
        .gte("starts_at", start)
        .lt("starts_at", weekEnd),
      db
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("park_id", ctx.park.id)
        .eq("outcome", "won")
        .gte("closed_at", monthStart),
    ]);

  const atThisPark = <T extends { lead: { park_id: string } | null }>(rows: T[] | null) =>
    (rows ?? []).filter((t) => !t.lead || t.lead.park_id === ctx.park.id);
  const tasks = atThisPark(tasksRes.data);
  const upcoming = atThisPark(upcomingRes.data);
  const tours = toursRes.data ?? [];
  const newLeads = newLeadsRes.data ?? [];
  const canEdit = roleAtLeast(ctx.role, "editor");
  const firstName = team.find((t) => t.userId === ctx.userId)?.name.split(" ")[0];

  const stats = [
    { label: "Open leads", value: openCount.count ?? 0, href: "/pipeline" },
    { label: "Tours in the next 7 days", value: toursWeek.count ?? 0, href: "/diary" },
    { label: "Sales this month", value: salesMonth.count ?? 0, href: "/leads?status=won" },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>
            {new Intl.DateTimeFormat("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: tz,
            }).format(new Date())}
          </Eyebrow>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">
            {firstName && firstName !== "Team" ? `Good to see you, ${firstName}` : "Today"}
          </h1>
        </div>
        {canEdit ? (
          <Button asChild className="md:hidden">
            <Link href="/leads/new">
              <Plus aria-hidden /> New lead
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border bg-card p-3 hover:border-foreground/30 sm:p-4"
          >
            <p className="font-display text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Your tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <TaskList
              tasks={tasks}
              timeZone={tz}
              canEdit={canEdit}
              empty="You're all caught up. New enquiries and follow-ups will appear here."
            />
            {upcoming.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                  Coming up this week ({upcoming.length})
                </summary>
                <div className="mt-2">
                  <TaskList tasks={upcoming} timeZone={tz} canEdit={canEdit} />
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Park tours today</CardTitle>
            </CardHeader>
            <CardContent>
              {tours.length ? (
                <ul className="divide-y">
                  {tours.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-3 text-sm">
                      <span className="w-12 font-semibold tabular-nums">
                        {formatTime(t.starts_at, tz)}
                      </span>
                      <Link
                        href={`/leads/${t.lead?.id}`}
                        className="flex-1 font-medium hover:underline"
                      >
                        {personName(t.lead?.person)}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {nameOf(team, t.advisor_id)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No park tours booked for today.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New enquiries this week</CardTitle>
            </CardHeader>
            <CardContent>
              {newLeads.length ? (
                <ul className="divide-y">
                  {newLeads.map((l) => (
                    <li key={l.id} className="py-3 text-sm">
                      <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                        {personName(l.person)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {SOURCE_LABEL[l.source]} · {ago(l.created_at)} ·{" "}
                        {nameOf(team, l.assigned_to)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No new enquiries in the last 7 days.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
