import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WORKSPACE_COOKIE } from "@/config/app";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Workspace, WorkspaceRole } from "@/lib/supabase/database.types";

export type Membership = { workspace: Workspace; role: WorkspaceRole };
export type WorkspaceContext = Membership & {
  memberships: Membership[];
  userId: string;
  email: string;
};

/** All workspaces the signed-in user belongs to (RLS-filtered). */
export const getMemberships = cache(async (): Promise<Membership[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("role, workspace:workspaces(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load workspaces: ${error.message}`);
  return (data ?? [])
    .filter((m): m is typeof m & { workspace: Workspace } => !!m.workspace)
    .map((m) => ({ role: m.role, workspace: m.workspace }));
});

/**
 * The workspace the user is working in: the one in the cookie if they still
 * belong to it, otherwise their first. No workspace → onboarding.
 */
export const getCurrentWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await requireUser();
  const memberships = await getMemberships();
  if (memberships.length === 0) redirect("/onboarding");
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = memberships.find((m) => m.workspace.id === selected) ?? memberships[0];
  return { ...current, memberships, userId: user.id, email: user.email };
});
