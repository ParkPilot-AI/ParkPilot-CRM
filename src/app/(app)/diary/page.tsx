import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { tourStatusAction } from "@/app/(app)/leads/actions";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentPark, getTeam, nameOf } from "@/lib/crm/context";
import { formatDay, formatTime, personName } from "@/lib/crm/format";
import { TOUR_STATUS_LABEL } from "@/lib/crm/labels";
import { addDays, dayBounds, zonedDate, zonedToUtc } from "@/lib/crm/time";
import { createClient } from "@/lib/supabase/server";
import { roleAtLeast } from "@/lib/workspace/roles";

export const metadata: Metadata = { title: "Diary" };

export default async function DiaryPage() {
  const ctx = await getCurrentPark();
  const tz = ctx.park.timezone;
  const team = await getTeam(ctx.workspace.id);
  const db = (await createClient()).schema("crm");
  const { start } = dayBounds(new Date(), tz);
  const until = zonedToUtc(addDays(zonedDate(new Date(), tz), 60), "00:00", tz).toISOString();
  const select =
    "id, starts_at, ends_at, status, advisor_id, notes, lead:leads(id, person:people(first_name, last_name, email, phone))";

  const [{ data: upcoming }, { data: awaiting }] = await Promise.all([
    db
      .from("tours")
      .select(select)
      .eq("park_id", ctx.park.id)
      .gte("starts_at", start)
      .lt("starts_at", until)
      .neq("status", "cancelled")
      .order("starts_at"),
    db
      .from("tours")
      .select(select)
      .eq("park_id", ctx.park.id)
      .eq("status", "scheduled")
      .lt("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .limit(30),
  ]);
  const canEdit = roleAtLeast(ctx.role, "editor");

  const days = new Map<string, NonNullable<typeof upcoming>>();
  for (const t of upcoming ?? []) {
    const key = zonedDate(new Date(t.starts_at), tz);
    days.set(key, [...(days.get(key) ?? []), t]);
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Diary"
        description={`Park tours at ${ctx.park.name} for the next 60 days. Book a tour from a lead's page.`}
      />

      {awaiting?.length && canEdit ? (
        <section aria-labelledby="awaiting">
          <h2 id="awaiting" className="mb-3 text-sm font-semibold">
            How did these tours go?
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {awaiting.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${t.lead?.id}`} className="font-medium hover:underline">
                    {personName(t.lead?.person)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatDay(t.starts_at, tz)}, {formatTime(t.starts_at, tz)} ·{" "}
                    {nameOf(team, t.advisor_id)}
                  </p>
                </div>
                {(["completed", "no_show"] as const).map((s) => (
                  <form key={s} action={tourStatusAction}>
                    <input type="hidden" name="tourId" value={t.id} />
                    <input type="hidden" name="status" value={s} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={s === "completed" ? "secondary" : "ghost"}
                    >
                      {s === "completed" ? "Completed" : "No-show"}
                    </Button>
                  </form>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {days.size ? (
        [...days.entries()].map(([day, tours]) => (
          <section key={day} aria-label={formatDay(tours[0].starts_at, tz)}>
            <h2 className="mb-3 border-t-2 border-accent pt-2 text-sm font-semibold">
              {formatDay(tours[0].starts_at, tz)}
            </h2>
            <ul className="divide-y rounded-xl border bg-card">
              {tours.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                  <span className="w-24 font-semibold tabular-nums">
                    {formatTime(t.starts_at, tz)}–{formatTime(t.ends_at, tz)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${t.lead?.id}`} className="font-medium hover:underline">
                      {personName(t.lead?.person)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      With {nameOf(team, t.advisor_id)}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </p>
                  </div>
                  {t.status !== "scheduled" ? (
                    <Badge variant="secondary">{TOUR_STATUS_LABEL[t.status]}</Badge>
                  ) : null}
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/api/tours/${t.id}/ics`} download aria-label="Add to calendar">
                      <CalendarPlus aria-hidden />{" "}
                      <span className="hidden sm:inline">Add to calendar</span>
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState
          title="No park tours booked"
          description="Open a lead and choose Book park tour. Booked tours appear here and on everyone's Today page."
        />
      )}
    </div>
  );
}
