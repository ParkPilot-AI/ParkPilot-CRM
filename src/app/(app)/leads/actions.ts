"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-message";
import { logAudit } from "@/lib/audit";
import { getCurrentPark, getTeam, type ParkContext } from "@/lib/crm/context";
import { personName, formatDateTime } from "@/lib/crm/format";
import { SOURCE_LABEL, TOUR_STATUS_LABEL } from "@/lib/crm/labels";
import { addDays, zonedDate, zonedToUtc } from "@/lib/crm/time";
import { sha256Hex } from "@/lib/security/crypto";
import { createClient } from "@/lib/supabase/server";
import type { ActivityType } from "@/lib/supabase/database.types";
import {
  addToEccoSchema,
  assignSchema,
  bookTourSchema,
  leadIdSchema,
  logActivitySchema,
  markLostSchema,
  markWonSchema,
  moveStageSchema,
  newLeadSchema,
  newTaskSchema,
  taskIdSchema,
  tourStatusSchema,
  updateLeadSchema,
} from "@/lib/validation/crm";
import { fieldErrors } from "@/lib/validation/workspace";
import { roleAtLeast } from "@/lib/workspace/roles";

const READ_ONLY: FormState = { message: "You have read-only access. Ask your sales manager." };

type Db = Awaited<ReturnType<typeof createClient>>;

async function editorContext(): Promise<{ ctx: ParkContext; supabase: Db } | null> {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "editor")) return null;
  return { ctx, supabase: await createClient() };
}

/** Load a lead in the user's workspace with the bits actions need (RLS applies). */
async function loadLead(supabase: Db, workspaceId: string, leadId: string) {
  const { data } = await supabase
    .schema("crm")
    .from("leads")
    .select(
      "id, workspace_id, park_id, person_id, stage, outcome, assigned_to, person:people(id, first_name, last_name, email, phone), park:parks(timezone)",
    )
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

/** Due time for a follow-up: 10:00 local time, `days` from today. */
function followUpAt(timeZone: string, days: number): string {
  return zonedToUtc(
    addDays(zonedDate(new Date(), timeZone), days),
    "10:00",
    timeZone,
  ).toISOString();
}

function refreshLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/today");
  revalidatePath("/leads");
}

async function isTeamMember(workspaceId: string, userId: string | null) {
  if (!userId) return true;
  return (await getTeam(workspaceId)).some((t) => t.userId === userId);
}

/* ---------------------------------------------------------------- New lead (phone, walk-in…) */

export async function createLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const { ctx, supabase } = ec;
  const parsed = newLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const assignedTo = d.assignedTo ?? ctx.userId;
  if (!(await isTeamMember(ctx.workspace.id, assignedTo)))
    return { errors: { assignedTo: ["Choose someone on your team"] } };

  const db = supabase.schema("crm");
  const ws = ctx.workspace.id;
  const phone = d.phone ? ((await db.rpc("normalize_phone", { p: d.phone })).data ?? null) : null;

  // Match an existing person on email, then phone, so nobody is entered twice.
  let personId: string | null = null;
  if (d.email) {
    const { data } = await db
      .from("people")
      .select("id")
      .eq("workspace_id", ws)
      .eq("email_normalized", d.email)
      .maybeSingle();
    personId = data?.id ?? null;
  }
  if (!personId && phone) {
    const { data } = await db
      .from("people")
      .select("id")
      .eq("workspace_id", ws)
      .eq("phone", phone)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    personId = data?.id ?? null;
  }

  if (personId) {
    const { data: existing } = await db.from("people").select("*").eq("id", personId).single();
    if (existing) {
      await db
        .from("people")
        .update({
          first_name: existing.first_name ?? d.firstName,
          last_name: existing.last_name ?? d.lastName,
          email: existing.email ?? d.email,
          phone: existing.phone ?? phone,
          postcode: existing.postcode ?? d.postcode,
        })
        .eq("id", personId);
    }
  } else {
    const { data, error } = await db
      .from("people")
      .insert({
        workspace_id: ws,
        first_name: d.firstName,
        last_name: d.lastName,
        email: d.email,
        phone,
        postcode: d.postcode,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !data) {
      return error?.code === "23505"
        ? { errors: { email: ["Someone with this email address was added a moment ago"] } }
        : { message: "We couldn't save this person. Please try again." };
    }
    personId = data.id;
  }

  const activityType: ActivityType =
    d.source === "walk_in" ? "walk_in" : d.source === "phone" ? "call" : "note";

  // A repeat enquiry joins their open lead at this park.
  const { data: open } = await db
    .from("leads")
    .select("id")
    .eq("workspace_id", ws)
    .eq("park_id", ctx.park.id)
    .eq("person_id", personId)
    .eq("outcome", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) {
    await db.from("activities").insert({
      workspace_id: ws,
      lead_id: open.id,
      person_id: personId,
      type: activityType,
      body: [`Enquired again (${SOURCE_LABEL[d.source].toLowerCase()}).`, d.note]
        .filter(Boolean)
        .join("\n\n"),
      created_by: ctx.userId,
    });
    refreshLead(open.id);
    redirect(`/leads/${open.id}?notice=repeat`);
  }

  const { data: lead, error } = await db
    .from("leads")
    .insert({
      workspace_id: ws,
      park_id: ctx.park.id,
      person_id: personId,
      source: d.source,
      source_detail: d.sourceDetail,
      interest: d.interest,
      budget_min: d.budgetMin,
      budget_max: d.budgetMax,
      part_exchange: d.partExchange,
      guest_to_owner: d.guestToOwner,
      assigned_to: assignedTo,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !lead) return { message: "We couldn't create the lead. Please try again." };

  if (d.note) {
    await db.from("activities").insert({
      workspace_id: ws,
      lead_id: lead.id,
      person_id: personId,
      type: activityType,
      body: d.note,
      created_by: ctx.userId,
    });
  }
  await db.from("tasks").insert({
    workspace_id: ws,
    lead_id: lead.id,
    person_id: personId,
    title: `Follow up with ${[d.firstName, d.lastName].filter(Boolean).join(" ")}`,
    due_at: followUpAt(ctx.park.timezone, 1),
    assigned_to: assignedTo,
    created_by: ctx.userId,
  });
  refreshLead(lead.id);
  redirect(`/leads/${lead.id}`);
}

/* ---------------------------------------------------------------- Edit details */

export async function updateLeadAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const { ctx, supabase } = ec;
  const parsed = updateLeadSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const lead = await loadLead(supabase, ctx.workspace.id, d.leadId);
  if (!lead) return { message: "Lead not found." };
  const db = supabase.schema("crm");

  const { error: personError } = await db
    .from("people")
    .update({
      first_name: d.firstName,
      last_name: d.lastName,
      email: d.email,
      phone: d.phone,
      postcode: d.postcode,
    })
    .eq("id", lead.person_id);
  if (personError) {
    return personError.code === "23505"
      ? { errors: { email: ["Another person already has this email address"] } }
      : personError.code === "23514"
        ? { errors: { phone: ["Enter a valid phone number"] } }
        : { message: "We couldn't save the changes." };
  }
  const { error } = await db
    .from("leads")
    .update({
      interest: d.interest,
      budget_min: d.budgetMin,
      budget_max: d.budgetMax,
      part_exchange: d.partExchange,
      guest_to_owner: d.guestToOwner,
      expected_close_on: d.expectedCloseOn,
      source_detail: d.sourceDetail,
    })
    .eq("id", lead.id);
  if (error) return { message: "We couldn't save the changes." };
  refreshLead(lead.id);
  return { ok: true, message: "Saved." };
}

/* ---------------------------------------------------------------- Pipeline moves */

export async function moveStageAction(formData: FormData) {
  const ec = await editorContext();
  if (!ec) return;
  const { leadId, stage } = moveStageSchema.parse(Object.fromEntries(formData));
  const lead = await loadLead(ec.supabase, ec.ctx.workspace.id, leadId);
  if (!lead || lead.outcome !== "open") return;
  // Closing a sale goes through "Mark as sold", which records the value.
  if (stage === "closed_sale") redirect(`/leads/${leadId}#outcome`);
  await ec.supabase.schema("crm").from("leads").update({ stage }).eq("id", leadId);
  refreshLead(leadId);
}

export async function markWonAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = markWonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const lead = await loadLead(supabase, ctx.workspace.id, parsed.data.leadId);
  if (!lead) return { message: "Lead not found." };
  const db = supabase.schema("crm");
  const { error } = await db
    .from("leads")
    .update({
      outcome: "won",
      stage: "closed_sale",
      sale_value: parsed.data.saleValue,
      lost_reason: null,
    })
    .eq("id", lead.id);
  if (error) return { message: "We couldn't mark this lead as sold." };
  await db.from("tasks").insert({
    workspace_id: ctx.workspace.id,
    lead_id: lead.id,
    person_id: lead.person_id,
    title: `Welcome ${personName(lead.person)} as a new owner`,
    details: "Handover, welcome pack and introduction to the owners' team.",
    due_at: followUpAt(lead.park?.timezone ?? ctx.park.timezone, 2),
    assigned_to: lead.assigned_to ?? ctx.userId,
    created_by: ctx.userId,
  });
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "crm.lead_won",
    targetType: "lead",
    targetId: lead.id,
    metadata: { sale_value: parsed.data.saleValue },
  });
  refreshLead(lead.id);
  revalidatePath("/owners");
  return { ok: true, message: "Marked as sold. Congratulations!" };
}

export async function markLostAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = markLostSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const lead = await loadLead(supabase, ctx.workspace.id, parsed.data.leadId);
  if (!lead) return { message: "Lead not found." };
  const db = supabase.schema("crm");
  const reason = [parsed.data.reason, parsed.data.detail].filter(Boolean).join(": ");
  const { error } = await db
    .from("leads")
    .update({ outcome: "lost", lost_reason: reason })
    .eq("id", lead.id);
  if (error) return { message: "We couldn't update this lead." };
  // Clear its open follow-ups so they don't clutter anyone's list.
  await db
    .from("tasks")
    .update({ completed_at: new Date().toISOString(), completed_by: ctx.userId })
    .eq("lead_id", lead.id)
    .is("completed_at", null);
  refreshLead(lead.id);
  return { ok: true, message: "Marked as lost." };
}

export async function reopenLeadAction(formData: FormData) {
  const ec = await editorContext();
  if (!ec) return;
  const { leadId } = leadIdSchema.parse(Object.fromEntries(formData));
  const lead = await loadLead(ec.supabase, ec.ctx.workspace.id, leadId);
  if (!lead || lead.outcome === "open") return;
  await ec.supabase
    .schema("crm")
    .from("leads")
    .update({
      outcome: "open",
      lost_reason: null,
      stage: lead.stage === "closed_sale" ? "park_tour" : lead.stage,
    })
    .eq("id", leadId);
  refreshLead(leadId);
}

export async function assignLeadAction(formData: FormData) {
  const ec = await editorContext();
  if (!ec) return;
  const { leadId, assignedTo } = assignSchema.parse(Object.fromEntries(formData));
  if (!(await isTeamMember(ec.ctx.workspace.id, assignedTo))) return;
  const db = ec.supabase.schema("crm");
  await db
    .from("leads")
    .update({ assigned_to: assignedTo })
    .eq("id", leadId)
    .eq("workspace_id", ec.ctx.workspace.id);
  // Their open follow-ups move with the lead.
  await db
    .from("tasks")
    .update({ assigned_to: assignedTo })
    .eq("lead_id", leadId)
    .is("completed_at", null);
  refreshLead(leadId);
}

/* ---------------------------------------------------------------- Timeline */

export async function logActivityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = logActivitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const lead = await loadLead(supabase, ctx.workspace.id, parsed.data.leadId);
  if (!lead) return { message: "Lead not found." };
  const { error } = await supabase.schema("crm").from("activities").insert({
    workspace_id: ctx.workspace.id,
    lead_id: lead.id,
    person_id: lead.person_id,
    type: parsed.data.type,
    body: parsed.data.body,
    created_by: ctx.userId,
  });
  if (error) return { message: "We couldn't save that." };
  refreshLead(lead.id);
  return { ok: true };
}

/* ---------------------------------------------------------------- Tasks */

export async function addTaskAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = newTaskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const d = parsed.data;
  const lead = await loadLead(supabase, ctx.workspace.id, d.leadId);
  if (!lead) return { message: "Lead not found." };
  const assignee = d.assignedTo ?? lead.assigned_to ?? ctx.userId;
  if (!(await isTeamMember(ctx.workspace.id, assignee)))
    return { errors: { assignedTo: ["Choose someone on your team"] } };
  const tz = lead.park?.timezone ?? ctx.park.timezone;
  const { error } = await supabase
    .schema("crm")
    .from("tasks")
    .insert({
      workspace_id: ctx.workspace.id,
      lead_id: lead.id,
      person_id: lead.person_id,
      title: d.title,
      due_at: d.dueDate ? zonedToUtc(d.dueDate, "10:00", tz).toISOString() : null,
      assigned_to: assignee,
      created_by: ctx.userId,
    });
  if (error) return { message: "We couldn't add the task." };
  refreshLead(lead.id);
  return { ok: true };
}

export async function completeTaskAction(formData: FormData) {
  const ec = await editorContext();
  if (!ec) return;
  const { taskId } = taskIdSchema.parse(Object.fromEntries(formData));
  const { data } = await ec.supabase
    .schema("crm")
    .from("tasks")
    .update({ completed_at: new Date().toISOString(), completed_by: ec.ctx.userId })
    .eq("id", taskId)
    .eq("workspace_id", ec.ctx.workspace.id)
    .is("completed_at", null)
    .select("lead_id")
    .maybeSingle();
  if (data?.lead_id) refreshLead(data.lead_id);
  revalidatePath("/today");
}

/* ---------------------------------------------------------------- Park tours */

export async function bookTourAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = bookTourSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const d = parsed.data;
  const lead = await loadLead(supabase, ctx.workspace.id, d.leadId);
  if (!lead) return { message: "Lead not found." };
  if (lead.outcome !== "open") return { message: "Reopen this lead before booking a tour." };
  const advisor = d.advisorId ?? lead.assigned_to ?? ctx.userId;
  if (!(await isTeamMember(ctx.workspace.id, advisor)))
    return { errors: { advisorId: ["Choose someone on your team"] } };

  const tz = lead.park?.timezone ?? ctx.park.timezone;
  const starts = zonedToUtc(d.date, d.time, tz);
  if (starts.getTime() < Date.now() - 60 * 60_000)
    return { errors: { date: ["That time has already passed"] } };
  const ends = new Date(starts.getTime() + d.duration * 60_000);

  const db = supabase.schema("crm");
  const { error } = await db.from("tours").insert({
    workspace_id: ctx.workspace.id,
    park_id: lead.park_id,
    lead_id: lead.id,
    advisor_id: advisor,
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    notes: d.notes,
    created_by: ctx.userId,
  });
  if (error) return { message: "We couldn't book the tour. Please try again." };
  await db.from("activities").insert({
    workspace_id: ctx.workspace.id,
    lead_id: lead.id,
    person_id: lead.person_id,
    type: "tour",
    body: `Park tour booked for ${formatDateTime(starts.toISOString(), tz)}.`,
    created_by: ctx.userId,
  });
  refreshLead(lead.id);
  revalidatePath("/diary");
  return {
    ok: true,
    message: "Park tour booked. Use “Add to calendar” to put it in Outlook or Google Calendar.",
  };
}

export async function tourStatusAction(formData: FormData) {
  const ec = await editorContext();
  if (!ec) return;
  const { tourId, status } = tourStatusSchema.parse(Object.fromEntries(formData));
  const { ctx, supabase } = ec;
  const db = supabase.schema("crm");
  const { data: tour } = await db
    .from("tours")
    .update({ status })
    .eq("id", tourId)
    .eq("workspace_id", ctx.workspace.id)
    .select("id, lead_id, advisor_id, starts_at")
    .maybeSingle();
  if (!tour) return;
  const lead = await loadLead(supabase, ctx.workspace.id, tour.lead_id);
  if (lead) {
    await db.from("activities").insert({
      workspace_id: ctx.workspace.id,
      lead_id: lead.id,
      person_id: lead.person_id,
      type: "tour",
      body: `Park tour ${TOUR_STATUS_LABEL[status].toLowerCase()}.`,
      created_by: ctx.userId,
    });
    const follow =
      status === "completed"
        ? `Follow up after ${personName(lead.person)}'s park tour`
        : status === "no_show"
          ? `Rearrange ${personName(lead.person)}'s park tour`
          : null;
    if (follow && lead.outcome === "open") {
      await db.from("tasks").insert({
        workspace_id: ctx.workspace.id,
        lead_id: lead.id,
        person_id: lead.person_id,
        title: follow,
        due_at: followUpAt(lead.park?.timezone ?? ctx.park.timezone, 1),
        assigned_to: tour.advisor_id ?? lead.assigned_to,
        created_by: ctx.userId,
      });
    }
    refreshLead(lead.id);
  }
  revalidatePath("/diary");
}

/* ---------------------------------------------------------------- ParkPilot ecco */

/**
 * Add the person to ecco's audience as a subscribed contact, recording how they consented.
 * Consent lives in ecco; the database links the contact back to this person automatically.
 */
export async function addToEccoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ec = await editorContext();
  if (!ec) return READ_ONLY;
  const parsed = addToEccoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { ctx, supabase } = ec;
  const lead = await loadLead(supabase, ctx.workspace.id, parsed.data.leadId);
  const email = lead?.person?.email?.trim().toLowerCase();
  if (!lead || !email) return { message: "Add an email address first." };

  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("reason")
    .eq("workspace_id", ctx.workspace.id)
    .eq("email_hash", sha256Hex(email))
    .maybeSingle();
  if (suppressed) {
    return {
      message:
        "This address has unsubscribed or can't receive email, so it can't be added. They can sign up again through one of your ecco forms.",
    };
  }

  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: ctx.workspace.id,
      email,
      first_name: lead.person?.first_name ?? null,
      last_name: lead.person?.last_name ?? null,
      status: "subscribed",
      consent_source: `crm: ${parsed.data.consentMethod}`,
      consent_at: new Date().toISOString(),
      consent_form: "ParkPilot CRM",
      consent_confirmed_by: ctx.userId,
      tags: ["crm"],
    })
    .select("id")
    .single();
  if (error || !contact) {
    return error?.code === "23505"
      ? { message: "This email address is already in ecco." }
      : { message: "We couldn't add them to ecco. Please try again." };
  }
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "contact.created",
    targetType: "contact",
    targetId: contact.id,
    metadata: { via: "crm", lead_id: lead.id, consent: parsed.data.consentMethod },
  });
  refreshLead(lead.id);
  return { ok: true, message: "Added to ecco. They can now be included in your ecco campaigns." };
}
