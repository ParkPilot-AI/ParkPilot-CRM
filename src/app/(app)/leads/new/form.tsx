"use client";

import { useActionState } from "react";
import { createLeadAction } from "../actions";
import { FieldError, FormMessage, type FormState } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { INTERESTS, MANUAL_SOURCES, SOURCE_LABEL } from "@/lib/crm/labels";

type Member = { userId: string; name: string };

export function NewLeadForm({ team, me }: { team: Member[]; me: string }) {
  const [state, action] = useActionState<FormState, FormData>(createLeadAction, undefined);
  const e = state?.errors;
  return (
    <form action={action} className="grid gap-6">
      <FormMessage state={state} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Who</legend>
        <div className="grid gap-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="off"
            autoCapitalize="words"
            maxLength={80}
            autoFocus
          />
          <FieldError errors={e?.firstName} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="off"
            autoCapitalize="words"
            maxLength={80}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={30}
          />
          <FieldError errors={e?.phone} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            maxLength={254}
          />
          <FieldError errors={e?.email} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="postcode">Postcode</Label>
          <Input
            id="postcode"
            name="postcode"
            autoCapitalize="characters"
            maxLength={12}
            className="sm:max-w-40"
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Enquiry</legend>
        <div className="grid gap-2">
          <Label htmlFor="source">How did they get in touch?</Label>
          <NativeSelect id="source" name="source" defaultValue="phone">
            {MANUAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sourceDetail">Where did they hear about us? (optional)</Label>
          <Input
            id="sourceDetail"
            name="sourceDetail"
            maxLength={200}
            placeholder="e.g. Facebook advert, a friend"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="interest">Interested in</Label>
          <NativeSelect id="interest" name="interest" defaultValue="">
            <option value="">Not asked yet</option>
            {INTERESTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-2">
            <Label htmlFor="budgetMin">Budget from (£)</Label>
            <Input id="budgetMin" name="budgetMin" inputMode="numeric" maxLength={12} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="budgetMax">to (£)</Label>
            <Input id="budgetMax" name="budgetMax" inputMode="numeric" maxLength={12} />
            <FieldError errors={e?.budgetMax} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="partExchange" className="size-4 accent-[var(--accent)]" />{" "}
          Has a holiday home to part-exchange
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="guestToOwner" className="size-4 accent-[var(--accent)]" />{" "}
          Has holidayed with us before
        </label>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="note">Notes (optional)</Label>
          <Textarea
            id="note"
            name="note"
            rows={4}
            maxLength={4000}
            placeholder="What did they ask about?"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="assignedTo">Advisor</Label>
          <NativeSelect id="assignedTo" name="assignedTo" defaultValue={me}>
            {team.map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.userId === me ? `${t.name} (you)` : t.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError errors={e?.assignedTo} />
        </div>
      </fieldset>
      <div>
        <SubmitButton pendingLabel="Saving…">Save lead</SubmitButton>
        <p className="mt-2 text-xs text-muted-foreground">
          If this person is already in the CRM, the enquiry is added to their existing lead.
        </p>
      </div>
    </form>
  );
}
