import Link from "next/link";
import { daysSince, initials, personName } from "@/lib/crm/format";
import { SOURCE_LABEL } from "@/lib/crm/labels";
import type { LeadSource, PersonRow } from "@/lib/supabase/database.types";

export type LeadCardData = {
  id: string;
  source: LeadSource;
  stage_changed_at: string;
  interest: string | null;
  part_exchange: boolean;
  person: Pick<PersonRow, "first_name" | "last_name" | "email" | "phone"> | null;
  assignedName: string | null;
};

export function LeadCard({ lead }: { lead: LeadCardData }) {
  const days = daysSince(lead.stage_changed_at);
  const name = personName(lead.person);
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="block rounded-xl border bg-card p-3 transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-tight">{name}</p>
        {lead.assignedName ? (
          <span
            title={lead.assignedName}
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold"
          >
            {initials(lead.assignedName)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {SOURCE_LABEL[lead.source]}
        {lead.interest ? ` · ${lead.interest}` : ""}
        {lead.part_exchange ? " · Part-exchange" : ""}
      </p>
      <p
        className={
          days >= 7 ? "mt-2 text-xs font-medium text-warning" : "mt-2 text-xs text-muted-foreground"
        }
      >
        {days === 0
          ? "In this stage since today"
          : `${days} day${days === 1 ? "" : "s"} in this stage`}
      </p>
    </Link>
  );
}
