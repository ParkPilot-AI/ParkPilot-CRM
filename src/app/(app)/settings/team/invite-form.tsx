"use client";

import { Copy, Check } from "lucide-react";
import { useActionState, useState } from "react";
import { inviteMemberAction, type InviteState } from "../actions";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import type { WorkspaceRole } from "@/lib/supabase/database.types";
import { ROLE_LABELS } from "@/lib/workspace/roles";

export function InviteForm({ roles }: { roles: WorkspaceRole[] }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="colleague@yourpark.co.uk"
          />
          <FieldError errors={state?.errors?.email} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-role">Role</Label>
          <NativeSelect id="invite-role" name="role" defaultValue="editor">
            {roles
              .filter((r) => r !== "owner")
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r].label}
                </option>
              ))}
          </NativeSelect>
        </div>
        <SubmitButton pendingLabel="Creating…">Create invite</SubmitButton>
      </form>
      <FormMessage state={state} />
      {state?.link ? (
        <div className="flex gap-2">
          <Input
            readOnly
            value={state.link}
            aria-label="Invitation link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
