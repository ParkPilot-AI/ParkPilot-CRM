import { Badge } from "@/components/ui/badge";
import { OUTCOME_LABEL, STAGES, STAGE_LABEL } from "@/lib/crm/labels";
import type { LeadOutcome, LeadStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export function OutcomeBadge({ outcome, stage }: { outcome: LeadOutcome; stage: LeadStage }) {
  if (outcome === "won") return <Badge variant="success">{OUTCOME_LABEL.won}</Badge>;
  if (outcome === "lost") return <Badge variant="secondary">{OUTCOME_LABEL.lost}</Badge>;
  return <Badge variant="outline">{STAGE_LABEL[stage]}</Badge>;
}

/** Four-step pipeline indicator: 2px top rules, red for done and current. */
export function StageStepper({ stage, outcome }: { stage: LeadStage; outcome: LeadOutcome }) {
  const current = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Pipeline stage">
      {STAGES.map((s, i) => {
        const done = i < current || (i === current && outcome === "won");
        const isCurrent = i === current && outcome !== "won";
        return (
          <li
            key={s.key}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "border-t-2 pt-2 text-xs font-medium",
              done || isCurrent ? "border-accent" : "border-border",
              outcome === "lost" && "border-border",
              isCurrent ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="tabular-nums text-muted-foreground">0{i + 1}</span>{" "}
            <span className="hidden sm:inline">{s.label}</span>
            <span className="sm:hidden">{s.short}</span>
          </li>
        );
      })}
    </ol>
  );
}
