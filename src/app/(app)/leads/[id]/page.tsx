import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, ExternalLink, Mail, MessageSquare, Phone } from "lucide-react";
import { OutcomeBadge, StageStepper } from "@/components/crm/stage";
import { TaskList } from "@/components/crm/task-list";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select";
import { getCurrentPark, getTeam, nameOf } from "@/lib/crm/context";
import {
  displayPhone,
  formatBudget,
  formatDate,
  formatDateTime,
  formatMoney,
  personName,
} from "@/lib/crm/format";
import {
  ACTIVITY_LABEL,
  SOURCE_LABEL,
  STAGES,
  STAGE_LABEL,
  TOUR_STATUS_LABEL,
} from "@/lib/crm/labels";
import { zonedDate } from "@/lib/crm/time";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Json, LeadStage } from "@/lib/supabase/database.types";
import { roleAtLeast } from "@/lib/workspace/roles";
import { assignLeadAction, moveStageAction, reopenLeadAction, tourStatusAction } from "../actions";
import {
  AddTaskForm,
  AddToEccoForm,
  BookTourForm,
  EditDetailsForm,
  LogActivityForm,
  LostForm,
  WonForm,
} from "./forms";

export const metadata: Metadata = { title: "Lead" };

const CONTACT_STATUS: Record<
  string,
  { label: string; variant: "success" | "secondary" | "warning" | "destructive" }
> = {
  subscribed: { label: "Subscribed", variant: "success" },
  pending: { label: "Awaiting confirmation", variant: "warning" },
  unsubscribed: { label: "Unsubscribed", variant: "secondary" },
  bounced: { label: "Email bounced", variant: "destructive" },
  complained: { label: "Marked as spam", variant: "destructive" },
};

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  open: "Opened",
  click: "Clicked a link",
  reply: "Replied",
  unsubscribe: "Unsubscribed",
  bounce: "Bounced",
  complaint: "Marked as spam",
  failed: "Failed to send",
};

function describe(type: string, metadata: Json): string | null {
  const m = (metadata ?? {}) as Record<string, Json>;
  if (type === "stage_change" && typeof m.to === "string")
    return `Moved to ${STAGE_LABEL[m.to as LeadStage] ?? m.to}`;
  if (type === "outcome_change")
    return m.to === "won" ? "Marked as sold" : m.to === "lost" ? "Marked as lost" : "Reopened";
  return null;
}

export default async function LeadPage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const { notice } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getCurrentPark();
  const supabase = await createClient();
  const db = supabase.schema("crm");

  const { data: lead } = await db
    .from("leads")
    .select("*, person:people(*), park:parks(id, name, timezone)")
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!lead || !lead.person) notFound();
  const person = lead.person;
  const tz = lead.park?.timezone ?? ctx.park.timezone;

  const [team, toursRes, tasksRes, activitiesRes, contactRes, eventsRes] = await Promise.all([
    getTeam(ctx.workspace.id),
    db.from("tours").select("*").eq("lead_id", lead.id).order("starts_at", { ascending: false }),
    db
      .from("tasks")
      .select("id, title, due_at, completed_at, assigned_to")
      .eq("lead_id", lead.id)
      .order("completed_at", { ascending: false, nullsFirst: true })
      .order("due_at", { ascending: true })
      .limit(30),
    db
      .from("activities")
      .select("*")
      .eq("lead_id", lead.id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    person.contact_id
      ? supabase
          .from("contacts")
          .select(
            "id, status, consent_source, consent_at, last_opened_at, last_replied_at, unsubscribed_at",
          )
          .eq("id", person.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    person.contact_id
      ? supabase
          .from("events")
          .select("id, type, occurred_at")
          .eq("contact_id", person.contact_id)
          .in("type", ["sent", "open", "click", "reply", "unsubscribe", "bounce", "complaint"])
          .order("occurred_at", { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] as { id: number; type: string; occurred_at: string }[] }),
  ]);

  const canEdit = roleAtLeast(ctx.role, "editor");
  const workers = team
    .filter((t) => t.role !== "viewer")
    .map((t) => ({ userId: t.userId, name: t.name }));
  const tours = toursRes.data ?? [];
  const tasks = (tasksRes.data ?? []).map((t) => ({
    ...t,
    lead: null,
    assigneeName: nameOf(team, t.assigned_to),
  }));
  const activities = activitiesRes.data ?? [];
  const contact = contactRes.data;
  const events = eventsRes.data ?? [];
  const name = personName(person);
  const open = lead.outcome === "open";
  const now = new Date().getTime();

  return (
    <div className="grid gap-6">
      {notice === "repeat" ? (
        <Alert variant="success">
          This person already had an open lead, so the new enquiry has been added to it.
        </Alert>
      ) : null}

      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              <Link href="/pipeline" className="hover:underline">
                Pipeline
              </Link>{" "}
              · {lead.park?.name}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <OutcomeBadge outcome={lead.outcome} stage={lead.stage} />
              {person.is_owner ? <Badge variant="success">Owner</Badge> : null}
              {lead.part_exchange ? <Badge variant="secondary">Part-exchange</Badge> : null}
              {lead.guest_to_owner ? <Badge variant="secondary">Past guest</Badge> : null}
            </div>
          </div>
          <div className="flex gap-2">
            {person.phone ? (
              <>
                <Button
                  asChild
                  variant="outline"
                  size="icon"
                  aria-label={`Call ${displayPhone(person.phone)}`}
                >
                  <a href={`tel:${person.phone}`}>
                    <Phone aria-hidden />
                  </a>
                </Button>
                <Button asChild variant="outline" size="icon" aria-label="Send a text message">
                  <a href={`sms:${person.phone}`}>
                    <MessageSquare aria-hidden />
                  </a>
                </Button>
              </>
            ) : null}
            {person.email ? (
              <Button asChild variant="outline" size="icon" aria-label={`Email ${person.email}`}>
                <a href={`mailto:${person.email}`}>
                  <Mail aria-hidden />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        <StageStepper stage={lead.stage} outcome={lead.outcome} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="grid content-start gap-6">
          {canEdit && open ? (
            <Card>
              <CardHeader>
                <CardTitle>Next step</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <form action={moveStageAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <div className="grid gap-1">
                    <label htmlFor="stage" className="text-xs font-medium">
                      Stage
                    </label>
                    <NativeSelect
                      id="stage"
                      name="stage"
                      defaultValue={lead.stage}
                      className="w-44"
                    >
                      {STAGES.filter((s) => s.key !== "closed_sale").map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button type="submit" variant="outline">
                    Move
                  </Button>
                </form>
                <form action={assignLeadAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <div className="grid gap-1">
                    <label htmlFor="assignedTo" className="text-xs font-medium">
                      Advisor
                    </label>
                    <NativeSelect
                      id="assignedTo"
                      name="assignedTo"
                      defaultValue={lead.assigned_to ?? ""}
                      className="w-44"
                    >
                      <option value="">Unassigned</option>
                      {workers.map((t) => (
                        <option key={t.userId} value={t.userId}>
                          {t.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button type="submit" variant="outline">
                    Reassign
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Park tours</CardTitle>
              <CardDescription>
                Booking a tour moves the lead to Appointment; completing it moves it to Park Tour.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {tours.length ? (
                <ul className="divide-y">
                  {tours.map((t) => {
                    const past = new Date(t.ends_at).getTime() < now;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{formatDateTime(t.starts_at, tz)}</p>
                          <p className="text-xs text-muted-foreground">
                            With {nameOf(team, t.advisor_id)}
                            {t.notes ? ` · ${t.notes}` : ""}
                          </p>
                        </div>
                        <Badge
                          variant={
                            t.status === "completed"
                              ? "success"
                              : t.status === "scheduled"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {TOUR_STATUS_LABEL[t.status]}
                        </Badge>
                        {t.status === "scheduled" ? (
                          <>
                            <Button asChild size="sm" variant="ghost">
                              <a href={`/api/tours/${t.id}/ics`} download>
                                <CalendarPlus aria-hidden /> Add to calendar
                              </a>
                            </Button>
                            {canEdit ? (
                              <div className="flex gap-1">
                                {(past
                                  ? (["completed", "no_show"] as const)
                                  : (["completed", "cancelled"] as const)
                                ).map((s) => (
                                  <form key={s} action={tourStatusAction}>
                                    <input type="hidden" name="tourId" value={t.id} />
                                    <input type="hidden" name="status" value={s} />
                                    <Button
                                      type="submit"
                                      size="sm"
                                      variant={s === "completed" ? "secondary" : "ghost"}
                                    >
                                      {s === "completed"
                                        ? "Completed"
                                        : s === "no_show"
                                          ? "No-show"
                                          : "Cancel"}
                                    </Button>
                                  </form>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No park tour booked yet.</p>
              )}
              {canEdit && open ? (
                <BookTourForm
                  leadId={lead.id}
                  team={workers}
                  defaultAdvisor={lead.assigned_to ?? ctx.userId}
                  today={zonedDate(new Date(), tz)}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <TaskList
                tasks={tasks}
                timeZone={tz}
                canEdit={canEdit}
                showLead={false}
                empty="No tasks for this lead."
              />
              {canEdit ? (
                <AddTaskForm
                  leadId={lead.id}
                  team={workers}
                  defaultAssignee={lead.assigned_to ?? ctx.userId}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              {canEdit ? <LogActivityForm leadId={lead.id} /> : null}
              <ol className="grid gap-4">
                {activities.map((a) => {
                  const auto = describe(a.type, a.metadata);
                  const meta = (a.metadata ?? {}) as Record<string, Json>;
                  return (
                    <li key={a.id} className="border-l-2 pl-4">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {ACTIVITY_LABEL[a.type]}
                        </span>
                        {" · "}
                        {formatDateTime(a.occurred_at, tz)}
                        {a.created_by
                          ? ` · ${nameOf(team, a.created_by)}`
                          : a.type === "ai_conversation"
                            ? " · ParkPilot AI"
                            : ""}
                      </p>
                      {auto ? <p className="mt-1 text-sm">{auto}</p> : null}
                      {a.body ? <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p> : null}
                      {typeof meta.transcript_url === "string" &&
                      meta.transcript_url.startsWith("https://") ? (
                        <a
                          href={meta.transcript_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
                        >
                          Read the conversation <ExternalLink className="size-3" aria-hidden />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
                <li className="border-l-2 pl-4">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Lead created</span> ·{" "}
                    {formatDateTime(lead.created_at, tz)} · {SOURCE_LABEL[lead.source]}
                  </p>
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {[
                  ["Phone", displayPhone(person.phone)],
                  ["Email", person.email],
                  ["Postcode", person.postcode],
                  [
                    "Source",
                    `${SOURCE_LABEL[lead.source]}${lead.source_detail ? ` (${lead.source_detail})` : ""}`,
                  ],
                  ["Interested in", lead.interest],
                  ["Budget", formatBudget(lead.budget_min, lead.budget_max)],
                  ["Buying by", formatDate(lead.expected_close_on, tz)],
                  ["Advisor", nameOf(team, lead.assigned_to)],
                  ["Created", formatDate(lead.created_at, tz)],
                  ...(lead.outcome === "won"
                    ? [
                        [
                          "Sold",
                          `${formatDate(lead.closed_at, tz)}${lead.sale_value ? ` · ${formatMoney(lead.sale_value)}` : ""}`,
                        ],
                      ]
                    : []),
                  ...(lead.outcome === "lost" ? [["Lost", lead.lost_reason]] : []),
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
              {canEdit ? (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-medium text-accent-text">
                    Edit details
                  </summary>
                  <div className="mt-4">
                    <EditDetailsForm
                      d={{
                        leadId: lead.id,
                        firstName: person.first_name ?? "",
                        lastName: person.last_name ?? "",
                        email: person.email ?? "",
                        phone: displayPhone(person.phone),
                        postcode: person.postcode ?? "",
                        interest: lead.interest ?? "",
                        budgetMin: lead.budget_min?.toString() ?? "",
                        budgetMax: lead.budget_max?.toString() ?? "",
                        partExchange: lead.part_exchange,
                        guestToOwner: lead.guest_to_owner,
                        expectedCloseOn: lead.expected_close_on ?? "",
                        sourceDetail: lead.source_detail ?? "",
                      }}
                    />
                  </div>
                </details>
              ) : null}
            </CardContent>
          </Card>

          {canEdit ? (
            <Card id="outcome">
              <CardHeader>
                <CardTitle>Outcome</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
                {open ? (
                  <>
                    <WonForm leadId={lead.id} />
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                        Not going ahead?
                      </summary>
                      <div className="mt-3">
                        <LostForm leadId={lead.id} />
                      </div>
                    </details>
                  </>
                ) : (
                  <form action={reopenLeadAction} className="grid gap-3">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <p className="text-sm text-muted-foreground">
                      {lead.outcome === "won" ? "Sold" : "Lost"} on {formatDate(lead.closed_at, tz)}
                      .
                    </p>
                    <div>
                      <Button type="submit" variant="outline" size="sm">
                        Reopen lead
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Marketing (ParkPilot ecco)</CardTitle>
              <CardDescription>
                Consent and unsubscribes are kept in ecco, so every campaign respects them.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {contact ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={CONTACT_STATUS[contact.status]?.variant ?? "secondary"}>
                      {CONTACT_STATUS[contact.status]?.label ?? contact.status}
                    </Badge>
                    {contact.consent_at ? (
                      <span className="text-xs text-muted-foreground">
                        Consent {formatDate(contact.consent_at, tz)}
                        {contact.consent_source ? ` · ${contact.consent_source}` : ""}
                      </span>
                    ) : null}
                  </div>
                  {events.length ? (
                    <ul className="grid gap-1 text-xs">
                      {events.map((e) => (
                        <li key={e.id} className="flex justify-between gap-2">
                          <span>{EVENT_LABEL[e.type] ?? e.type}</span>
                          <span className="text-muted-foreground">
                            {formatDateTime(e.occurred_at, tz)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No campaign activity yet.</p>
                  )}
                  <a
                    href={`${publicEnv.NEXT_PUBLIC_ECCO_URL}/audience/contacts/${contact.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
                  >
                    Open in ecco <ExternalLink className="size-3" aria-hidden />
                  </a>
                </>
              ) : person.email ? (
                canEdit ? (
                  <>
                    <p className="text-muted-foreground">
                      Not in ecco yet. Only add people who have agreed to marketing emails.
                    </p>
                    <AddToEccoForm leadId={lead.id} />
                  </>
                ) : (
                  <p className="text-muted-foreground">Not in ecco.</p>
                )
              ) : (
                <p className="text-muted-foreground">
                  Add an email address to include them in ecco campaigns.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
