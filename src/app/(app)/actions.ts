"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PARK_COOKIE, WORKSPACE_COOKIE } from "@/config/app";
import { getParks } from "@/lib/crm/context";
import { getCurrentWorkspace, getMemberships } from "@/lib/workspace/current";
import { workspaceCookieOptions } from "@/lib/workspace/cookie";
import { switchParkSchema } from "@/lib/validation/crm";
import { switchWorkspaceSchema } from "@/lib/validation/workspace";

export async function switchWorkspaceAction(formData: FormData) {
  const { workspaceId } = switchWorkspaceSchema.parse(Object.fromEntries(formData));
  const memberships = await getMemberships();
  if (!memberships.some((m) => m.workspace.id === workspaceId)) redirect("/today");
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, workspaceCookieOptions());
  jar.delete(PARK_COOKIE);
  redirect("/today");
}

export async function switchParkAction(formData: FormData) {
  const { parkId } = switchParkSchema.parse(Object.fromEntries(formData));
  const ctx = await getCurrentWorkspace();
  const parks = await getParks(ctx.workspace.id);
  if (parks.some((p) => p.id === parkId)) {
    (await cookies()).set(PARK_COOKIE, parkId, workspaceCookieOptions());
  }
  redirect("/today");
}
