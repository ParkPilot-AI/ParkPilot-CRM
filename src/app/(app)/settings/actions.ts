"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/ui/form-message";
import { PARK_COOKIE } from "@/config/app";
import { logAudit } from "@/lib/audit";
import { getCurrentPark, getTeam } from "@/lib/crm/context";
import { requestOrigin } from "@/lib/request";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { createClient } from "@/lib/supabase/server";
import { parkSchema, parkStaffSchema, updateParkSchema } from "@/lib/validation/crm";
import {
  changeRoleSchema,
  fieldErrors,
  inviteSchema,
  removeMemberSchema,
  revokeInviteSchema,
} from "@/lib/validation/workspace";
import { workspaceCookieOptions } from "@/lib/workspace/cookie";
import { assignableRoles, roleAtLeast } from "@/lib/workspace/roles";

const FORBIDDEN: FormState = { message: "Only a sales manager or owner can do that." };

/* ---------------------------------------------------------------- Parks */

export async function updateParkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "admin")) return FORBIDDEN;
  const parsed = updateParkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { error } = await (
    await createClient()
  )
    .schema("crm")
    .from("parks")
    .update({ name: parsed.data.name, timezone: parsed.data.timezone })
    .eq("id", parsed.data.parkId)
    .eq("workspace_id", ctx.workspace.id);
  if (error)
    return error.code === "23505"
      ? { errors: { name: ["You already have a park with this name"] } }
      : { message: "Couldn't save the park." };
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "crm.park_updated",
    targetType: "park",
    targetId: parsed.data.parkId,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function addParkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "owner")) return { message: "Only an owner can add parks." };
  const parsed = parkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const db = (await createClient()).schema("crm");
  const { data, error } = await db
    .from("parks")
    .insert({
      workspace_id: ctx.workspace.id,
      name: parsed.data.name,
      timezone: parsed.data.timezone,
    })
    .select("id")
    .single();
  if (error || !data)
    return error?.code === "23505"
      ? { errors: { name: ["You already have a park with this name"] } }
      : { message: "Couldn't add the park." };
  await db
    .from("park_staff")
    .insert({ park_id: data.id, workspace_id: ctx.workspace.id, user_id: ctx.userId });
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "crm.park_created",
    targetType: "park",
    targetId: data.id,
  });
  (await cookies()).set(PARK_COOKIE, data.id, workspaceCookieOptions());
  revalidatePath("/", "layout");
  return { ok: true, message: `${parsed.data.name} added. You're now working in it.` };
}

/** Who works at the current park, and who receives its new leads (fair sharing). */
export async function setParkStaffAction(formData: FormData) {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "admin")) return;
  const { userId, works, takesLeads } = parkStaffSchema.parse(Object.fromEntries(formData));
  if (!(await getTeam(ctx.workspace.id)).some((t) => t.userId === userId)) return;
  const db = (await createClient()).schema("crm");
  if (!works) {
    await db.from("park_staff").delete().eq("park_id", ctx.park.id).eq("user_id", userId);
  } else {
    await db.from("park_staff").upsert(
      {
        park_id: ctx.park.id,
        workspace_id: ctx.workspace.id,
        user_id: userId,
        takes_leads: takesLeads,
      },
      { onConflict: "park_id,user_id" },
    );
  }
  revalidatePath("/settings/team");
}

/* ---------------------------------------------------------------- Team (shared with ecco) */

export type InviteState = (NonNullable<FormState> & { link?: string }) | undefined;

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "admin")) return FORBIDDEN;
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  if (!assignableRoles(ctx.role).includes(parsed.data.role)) return FORBIDDEN;

  const token = randomToken();
  const { error } = await (await createClient()).from("workspace_invitations").insert({
    workspace_id: ctx.workspace.id,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: sha256Hex(token),
    invited_by: ctx.userId,
  });
  if (error) return { message: "Couldn't create the invitation." };
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "member.invited",
    metadata: { email: parsed.data.email, role: parsed.data.role, via: "crm" },
  });
  revalidatePath("/settings/team");
  return {
    ok: true,
    message: `Invitation created for ${parsed.data.email}. Copy the link and send it to them. It's shown only once and expires in 7 days.`,
    link: `${await requestOrigin()}/invite/${token}`,
  };
}

export async function revokeInviteAction(formData: FormData) {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "admin")) return;
  const { id } = revokeInviteSchema.parse(Object.fromEntries(formData));
  await (
    await createClient()
  )
    .from("workspace_invitations")
    .delete()
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id);
  await logAudit({
    workspaceId: ctx.workspace.id,
    actorId: ctx.userId,
    action: "member.invite_revoked",
    targetId: id,
  });
  revalidatePath("/settings/team");
}

export async function changeRoleAction(formData: FormData) {
  const ctx = await getCurrentPark();
  const { userId, role } = changeRoleSchema.parse(Object.fromEntries(formData));
  if (!assignableRoles(ctx.role).includes(role)) return;
  // RLS also stops admins editing owners; a database trigger keeps at least one owner.
  const { error } = await (
    await createClient()
  )
    .from("members")
    .update({ role })
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId);
  if (!error)
    await logAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "member.role_changed",
      targetType: "user",
      targetId: userId,
      metadata: { role },
    });
  revalidatePath("/settings/team");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await getCurrentPark();
  const { userId } = removeMemberSchema.parse(Object.fromEntries(formData));
  if (userId !== ctx.userId && !roleAtLeast(ctx.role, "admin")) return;
  const { error } = await (
    await createClient()
  )
    .from("members")
    .delete()
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", userId);
  if (!error)
    await logAudit({
      workspaceId: ctx.workspace.id,
      actorId: ctx.userId,
      action: "member.removed",
      targetType: "user",
      targetId: userId,
    });
  revalidatePath("/settings/team");
}
