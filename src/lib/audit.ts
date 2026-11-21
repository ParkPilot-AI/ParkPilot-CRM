import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Append to the workspace audit log. Uses the service role because audit_log
 * has no client INSERT policy (members can't forge entries). Call only after
 * the action has been authorised.
 */
export async function logAudit(entry: {
  workspaceId: string;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, Json>;
}) {
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      workspace_id: entry.workspaceId,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    });
  if (error)
    console.error("audit_log insert failed", { action: entry.action, error: error.message });
}
