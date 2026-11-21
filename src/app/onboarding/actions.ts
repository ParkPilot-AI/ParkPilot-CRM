"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form-message";
import { PARK_COOKIE, WORKSPACE_COOKIE } from "@/config/app";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { randomToken } from "@/lib/security/crypto";
import { slugify } from "@/lib/utils";
import { workspaceCookieOptions } from "@/lib/workspace/cookie";
import { getMemberships } from "@/lib/workspace/current";
import { roleAtLeast } from "@/lib/workspace/roles";
import { onboardingSchema } from "@/lib/validation/crm";
import { fieldErrors } from "@/lib/validation/workspace";

/**
 * First run. With no workspace yet: create the operator's workspace (shared with ParkPilot ecco)
 * and the first park. With a workspace but no park (e.g. an ecco customer): add the park.
 */
export async function setUpParkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const { parkName } = parsed.data;
  const operatorName = parsed.data.operatorName ?? parkName;

  const supabase = await createClient();
  const memberships = await getMemberships();
  const jar = await cookies();
  let workspaceId = memberships.find((m) => m.workspace.id === jar.get(WORKSPACE_COOKIE)?.value)
    ?.workspace.id;
  workspaceId ??= memberships[0]?.workspace.id;

  if (!workspaceId) {
    const base = slugify(operatorName) || "park";
    const suffix =
      randomToken(4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "crm";
    const { data, error } = await supabase.rpc("create_workspace", {
      p_name: operatorName,
      p_slug: `${base.slice(0, 40)}-${suffix}`,
    });
    if (error || !data) return { message: "We couldn't set up your account. Please try again." };
    workspaceId = data.id;
    await logAudit({
      workspaceId,
      actorId: user.id,
      action: "workspace.created",
      targetType: "workspace",
      targetId: workspaceId,
      metadata: { via: "crm" },
    });
  } else {
    const role = memberships.find((m) => m.workspace.id === workspaceId)?.role;
    if (!roleAtLeast(role, "admin"))
      return { message: "Only an admin can add a park. Ask your sales manager to set it up." };
  }

  const { data: park, error } = await supabase
    .schema("crm")
    .from("parks")
    .insert({ workspace_id: workspaceId, name: parkName })
    .select("id")
    .single();
  if (error || !park) {
    return error?.code === "23505"
      ? { errors: { parkName: ["You already have a park with this name"] } }
      : { message: "We couldn't add the park. Please try again." };
  }
  // The person setting up works at the park and receives its leads to begin with.
  await supabase
    .schema("crm")
    .from("park_staff")
    .insert({ park_id: park.id, workspace_id: workspaceId, user_id: user.id });
  await logAudit({
    workspaceId,
    actorId: user.id,
    action: "crm.park_created",
    targetType: "park",
    targetId: park.id,
  });

  jar.set(WORKSPACE_COOKIE, workspaceId, workspaceCookieOptions());
  jar.set(PARK_COOKIE, park.id, workspaceCookieOptions());
  redirect("/today");
}
