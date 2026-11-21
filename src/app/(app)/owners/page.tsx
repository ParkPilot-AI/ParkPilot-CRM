import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getCurrentPark } from "@/lib/crm/context";
import { displayPhone, formatDate, formatMoney, personName } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Owners" };

export default async function OwnersPage() {
  const ctx = await getCurrentPark();
  const db = (await createClient()).schema("crm");
  const { data: sales } = await db
    .from("leads")
    .select(
      "id, closed_at, sale_value, guest_to_owner, part_exchange, person:people(id, first_name, last_name, email, phone, owner_since)",
    )
    .eq("park_id", ctx.park.id)
    .eq("outcome", "won")
    .order("closed_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <PageHeader
        title="Owners"
        description={`People who have bought a holiday home at ${ctx.park.name}, newest first.`}
      />
      {sales?.length ? (
        <ul className="divide-y rounded-xl border bg-card">
          {sales.map((s) => (
            <li key={s.id}>
              <Link
                href={`/leads/${s.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{personName(s.person)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[s.person?.email, displayPhone(s.person?.phone)].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  Bought {formatDate(s.closed_at, ctx.park.timezone)}
                  {s.sale_value ? ` · ${formatMoney(s.sale_value)}` : ""}
                  {s.guest_to_owner ? " · Past guest" : ""}
                  {s.part_exchange ? " · Part-exchange" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No owners yet"
          description="When you mark a lead as sold, the buyer appears here as an owner."
        />
      )}
    </div>
  );
}
