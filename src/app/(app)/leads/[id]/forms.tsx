"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  addTaskAction,
  addToEccoAction,
  bookTourAction,
  logActivityAction,
  markLostAction,
  markWonAction,
  updateLeadAction,
} from "../actions";
import { FieldError, FormMessage, type FormState } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTIVITY_LABEL,
  CONSENT_METHODS,
  INTERESTS,
  LOGGABLE_ACTIVITIES,
  LOST_REASONS,
} from "@/lib/crm/labels";

type Member = { userId: string; name: string };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** useActionState plus a form ref that clears the form after a successful submit. */
function useResettingAction(action: Action) {
  const [state, run] = useActionState<FormState, FormData>(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return [state, run, ref] as const;
}

const checkboxClass = "size-4 accent-[var(--accent)]";

export function LogActivityForm({ leadId }: { leadId: string }) {
  const [state, action, ref] = useResettingAction(logActivityAction);
  return (
    <form ref={ref} action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <NativeSelect name="type" defaultValue="note" aria-label="What happened">
          {LOGGABLE_ACTIVITIES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_LABEL[t]}
            </option>
          ))}
        </NativeSelect>
        <Textarea
          name="body"
          rows={2}
          maxLength={4000}
          placeholder="What was said or agreed?"
          aria-label="Details"
          required
        />
      </div>
      <FieldError errors={state?.errors?.body} />
      {state?.ok ? null : <FormMessage state={state} />}
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
          Add to timeline
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddTaskForm({
  leadId,
  team,
  defaultAssignee,
}: {
  leadId: string;
  team: Member[];
  defaultAssignee: string;
}) {
  const [state, action, ref] = useResettingAction(addTaskAction);
  return (
    <form
      ref={ref}
      action={action}
      className="grid gap-3 sm:grid-cols-[1fr_150px_160px_auto] sm:items-end"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-1">
        <Label htmlFor="task-title" className="text-xs">
          New task
        </Label>
        <Input
          id="task-title"
          name="title"
          maxLength={200}
          placeholder="e.g. Send brochure"
          required
        />
        <FieldError errors={state?.errors?.title} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="task-due" className="text-xs">
          Due
        </Label>
        <Input id="task-due" name="dueDate" type="date" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="task-who" className="text-xs">
          For
        </Label>
        <NativeSelect id="task-who" name="assignedTo" defaultValue={defaultAssignee}>
          {team.map((t) => (
            <option key={t.userId} value={t.userId}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <SubmitButton size="default" variant="secondary" pendingLabel="Adding…">
        Add
      </SubmitButton>
      {state?.ok ? null : (
        <div className="sm:col-span-4">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}

export function BookTourForm({
  leadId,
  team,
  defaultAdvisor,
  today,
}: {
  leadId: string;
  team: Member[];
  defaultAdvisor: string;
  today: string;
}) {
  const [state, action, ref] = useResettingAction(bookTourAction);
  const e = state?.errors;
  return (
    <form ref={ref} action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormMessage state={state} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="tour-date" className="text-xs">
            Date
          </Label>
          <Input id="tour-date" name="date" type="date" min={today} required />
          <FieldError errors={e?.date} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tour-time" className="text-xs">
            Time
          </Label>
          <Input id="tour-time" name="time" type="time" step={900} defaultValue="11:00" required />
          <FieldError errors={e?.time} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tour-duration" className="text-xs">
            Length
          </Label>
          <NativeSelect id="tour-duration" name="duration" defaultValue="60">
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1½ hours</option>
            <option value="120">2 hours</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tour-advisor" className="text-xs">
            With
          </Label>
          <NativeSelect id="tour-advisor" name="advisorId" defaultValue={defaultAdvisor}>
            {team.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError errors={e?.advisorId} />
        </div>
      </div>
      <Input
        name="notes"
        maxLength={1000}
        placeholder="Notes for the tour (optional)"
        aria-label="Tour notes"
      />
      <div>
        <SubmitButton variant="secondary" pendingLabel="Booking…">
          Book park tour
        </SubmitButton>
      </div>
    </form>
  );
}

export function WonForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<FormState, FormData>(markWonAction, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormMessage state={state} />
      <div className="grid gap-1">
        <Label htmlFor="saleValue" className="text-xs">
          Sale price (£, optional)
        </Label>
        <Input
          id="saleValue"
          name="saleValue"
          inputMode="decimal"
          maxLength={14}
          placeholder="e.g. 89,995"
        />
        <FieldError errors={state?.errors?.saleValue} />
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">Mark as sold</SubmitButton>
      </div>
    </form>
  );
}

export function LostForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<FormState, FormData>(markLostAction, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="lost-reason" className="text-xs">
            Reason
          </Label>
          <NativeSelect id="lost-reason" name="reason" defaultValue="" required>
            <option value="" disabled>
              Choose a reason
            </option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </NativeSelect>
          <FieldError errors={state?.errors?.reason} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="lost-detail" className="text-xs">
            Detail (optional)
          </Label>
          <Input id="lost-detail" name="detail" maxLength={300} />
        </div>
      </div>
      <div>
        <SubmitButton variant="outline" pendingLabel="Saving…">
          Mark as lost
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddToEccoForm({ leadId }: { leadId: string }) {
  const [state, action] = useActionState<FormState, FormData>(addToEccoAction, undefined);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <FormMessage state={state} />
      <div className="grid gap-1">
        <Label htmlFor="consentMethod" className="text-xs">
          How did they agree?
        </Label>
        <NativeSelect id="consentMethod" name="consentMethod" defaultValue={CONSENT_METHODS[1]}>
          {CONSENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </NativeSelect>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="consentConfirmed"
          required
          className={`${checkboxClass} mt-0.5`}
        />
        <span>They agreed to receive marketing emails from us.</span>
      </label>
      <FieldError errors={state?.errors?.consentConfirmed} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">
          Add to ecco
        </SubmitButton>
      </div>
    </form>
  );
}

export type LeadDetails = {
  leadId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  postcode: string;
  interest: string;
  budgetMin: string;
  budgetMax: string;
  partExchange: boolean;
  guestToOwner: boolean;
  expectedCloseOn: string;
  sourceDetail: string;
};

export function EditDetailsForm({ d }: { d: LeadDetails }) {
  const [state, action] = useActionState<FormState, FormData>(updateLeadAction, undefined);
  const e = state?.errors;
  const field = (
    name: keyof LeadDetails,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={`edit-${name}`} className="text-xs">
        {label}
      </Label>
      <Input id={`edit-${name}`} name={name} defaultValue={String(d[name] ?? "")} {...props} />
      <FieldError errors={e?.[name]} />
    </div>
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="leadId" value={d.leadId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        {field("firstName", "First name", { maxLength: 80 })}
        {field("lastName", "Last name", { maxLength: 80 })}
        {field("phone", "Phone", { type: "tel", maxLength: 30 })}
        {field("email", "Email", { type: "email", maxLength: 254 })}
        {field("postcode", "Postcode", { maxLength: 12 })}
        <div className="grid gap-1">
          <Label htmlFor="edit-interest" className="text-xs">
            Interested in
          </Label>
          <NativeSelect id="edit-interest" name="interest" defaultValue={d.interest}>
            <option value="">Not asked yet</option>
            {INTERESTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </NativeSelect>
        </div>
        {field("budgetMin", "Budget from (£)", { inputMode: "numeric", maxLength: 12 })}
        {field("budgetMax", "Budget to (£)", { inputMode: "numeric", maxLength: 12 })}
        {field("expectedCloseOn", "Expected to buy by", { type: "date" })}
        {field("sourceDetail", "Heard about us from", { maxLength: 200 })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="partExchange"
          defaultChecked={d.partExchange}
          className={checkboxClass}
        />{" "}
        Has a holiday home to part-exchange
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="guestToOwner"
          defaultChecked={d.guestToOwner}
          className={checkboxClass}
        />{" "}
        Has holidayed with us before
      </label>
      <div>
        <SubmitButton size="sm" pendingLabel="Saving…">
          Save details
        </SubmitButton>
      </div>
    </form>
  );
}
