import Link from "next/link";
import { Check, Phone } from "lucide-react";
import { completeTaskAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { displayPhone, formatDateTime, personName } from "@/lib/crm/format";
import type { PersonRow } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type TaskItem = {
  id: string;
  title: string;
  due_at: string | null;
  completed_at?: string | null;
  lead: {
    id: string;
    person: Pick<PersonRow, "first_name" | "last_name" | "email" | "phone"> | null;
  } | null;
  assigneeName?: string;
};

export function TaskList({
  tasks,
  timeZone,
  canEdit,
  showLead = true,
  empty = "Nothing to do.",
}: {
  tasks: TaskItem[];
  timeZone: string;
  canEdit: boolean;
  showLead?: boolean;
  empty?: string;
}) {
  if (!tasks.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const now = new Date().getTime();
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const overdue = !t.completed_at && t.due_at && new Date(t.due_at).getTime() < now;
        const phone = t.lead?.person?.phone;
        return (
          <li key={t.id} className="flex items-center gap-3 py-3">
            {canEdit && !t.completed_at ? (
              <form action={completeTaskAction}>
                <input type="hidden" name="taskId" value={t.id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-full"
                  aria-label={`Mark “${t.title}” as done`}
                >
                  <Check className="size-4" aria-hidden />
                </Button>
              </form>
            ) : (
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
                aria-label="Done"
              >
                <Check className="size-4" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm font-medium",
                  t.completed_at && "text-muted-foreground line-through",
                )}
              >
                {t.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {showLead && t.lead ? (
                  <Link href={`/leads/${t.lead.id}`} className="hover:underline">
                    {personName(t.lead.person)}
                  </Link>
                ) : null}
                {showLead && t.lead && t.due_at ? " · " : null}
                {t.due_at ? (
                  <span className={overdue ? "font-medium text-destructive" : undefined}>
                    {overdue ? "Overdue: " : "Due "}
                    {formatDateTime(t.due_at, timeZone)}
                  </span>
                ) : null}
                {t.assigneeName ? ` · ${t.assigneeName}` : null}
              </p>
            </div>
            {phone ? (
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label={`Call ${displayPhone(phone)}`}
              >
                <a href={`tel:${phone}`}>
                  <Phone className="size-4" aria-hidden />
                </a>
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
