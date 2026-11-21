import type { WorkspaceRole } from "@/lib/supabase/database.types";

export const ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor", "viewer"] as const;

const RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

/** Mirrors private.has_role() in the database. UI hint only; RLS is the enforcement. */
export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

/** CRM wording. Roles are shared with ParkPilot ecco: one role per person per operator. */
export const ROLE_LABELS: Record<WorkspaceRole, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Everything, including adding parks and owners" },
  admin: { label: "Sales manager", description: "Parks, team and settings, plus all leads" },
  editor: { label: "Sales advisor", description: "Works leads, tasks and park tours" },
  viewer: { label: "Viewer", description: "Read-only access" },
};

/** Roles an actor may assign to others. Only owners can create owners. */
export function assignableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  if (actor === "owner") return ["owner", "admin", "editor", "viewer"];
  if (actor === "admin") return ["admin", "editor", "viewer"];
  return [];
}
