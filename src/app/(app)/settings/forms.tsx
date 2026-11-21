"use client";

import { useActionState } from "react";
import { addParkAction, updateParkAction } from "./actions";
import { FieldError, FormMessage, type FormState } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

export function ParkForm({ park }: { park: { id: string; name: string; timezone: string } }) {
  const [state, action] = useActionState<FormState, FormData>(updateParkAction, undefined);
  return (
    <form action={action} className="grid gap-4 sm:max-w-md">
      <input type="hidden" name="parkId" value={park.id} />
      <FormMessage state={state} />
      <div className="grid gap-2">
        <Label htmlFor="park-name">Park name</Label>
        <Input
          id="park-name"
          name="name"
          defaultValue={park.name}
          required
          minLength={2}
          maxLength={120}
        />
        <FieldError errors={state?.errors?.name} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="park-tz">Time zone</Label>
        <Input id="park-tz" name="timezone" defaultValue={park.timezone} required maxLength={60} />
        <FieldError errors={state?.errors?.timezone} />
        <p className="text-xs text-muted-foreground">
          Park tour times use this. UK parks: Europe/London.
        </p>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function AddParkForm() {
  const [state, action] = useActionState<FormState, FormData>(addParkAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="timezone" value="Europe/London" />
      <div className="grid gap-2">
        <Label htmlFor="new-park">Add another park</Label>
        <Input
          id="new-park"
          name="name"
          placeholder="Park name"
          required
          minLength={2}
          maxLength={120}
        />
        <FieldError errors={state?.errors?.name} />
      </div>
      <SubmitButton variant="secondary" pendingLabel="Adding…">
        Add park
      </SubmitButton>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
