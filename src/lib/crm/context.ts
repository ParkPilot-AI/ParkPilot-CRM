import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PARK_COOKIE } from "@/config/app";
import { createClient } from "@/lib/supabase/server";
import type { ParkRow, WorkspaceRole } from "@/lib/supabase/database.types";
import { getCurrentWorkspace, type WorkspaceContext } from "@/lib/workspace/current";

export type ParkContext = WorkspaceContext & { park: ParkRow; parks: ParkRow[] };

/** All active parks in the current workspace (operator). */
export const getParks = cache(async (workspaceId: string): Promise<ParkRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("crm")
    .from("parks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`Could not load parks: ${error.message}`);
  return data ?? [];
});

/**
 * The park the user is working in: the one in the cookie if it's still in their workspace,
 * otherwise the first. No workspace or no park → onboarding.
 */
export const getCurrentPark = cache(async (): Promise<ParkContext> => {
  const ctx = await getCurrentWorkspace();
  const parks = await getParks(ctx.workspace.id);
  if (parks.length === 0) redirect("/onboarding");
  const selected = (await cookies()).get(PARK_COOKIE)?.value;
  const park = parks.find((p) => p.id === selected) ?? parks[0];
  return { ...ctx, park, parks };
});

export type TeamMember = { userId: string; name: string; role: WorkspaceRole };

/** Everyone in the workspace, with display names (falls back to "Team member"). */
export const getTeam = cache(async (workspaceId: string): Promise<TeamMember[]> => {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return (members ?? []).map((m) => ({
    userId: m.user_id,
    role: m.role,
    name: names.get(m.user_id)?.trim() || "Team member",
  }));
});

/** Lookup helper for "assigned to" names. */
export function nameOf(team: TeamMember[], userId: string | null | undefined): string {
  if (!userId) return "Unassigned";
  return team.find((t) => t.userId === userId)?.name ?? "Former team member";
}
