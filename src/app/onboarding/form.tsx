"use client";

import { useActionState } from "react";
import { setUpParkAction } from "./actions";
import { FieldError, FormMessage, type FormState } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

export function SetUpParkForm({ askOperator }: { askOperator: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setUpParkAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div className="grid gap-2">
        <Label htmlFor="parkName">Park name</Label>
        <Input
          id="parkName"
          name="parkName"
          placeholder="e.g. Havenwood Lodge Park"
          required
          minLength={2}
          maxLength={120}
          autoFocus
        />
        <FieldError errors={state?.errors?.parkName} />
      </div>
      {askOperator ? (
        <div className="grid gap-2">
          <Label htmlFor="operatorName">Company or group name (optional)</Label>
          <Input id="operatorName" name="operatorName" maxLength={120} />
          <p className="text-xs text-muted-foreground">
            Leave blank if it&apos;s the same as the park. Groups can add more parks later.
          </p>
        </div>
      ) : null}
      <SubmitButton pendingLabel="Setting up…">Start using ParkPilot CRM</SubmitButton>
    </form>
  );
}
