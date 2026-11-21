import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, supabaseSecretKey } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES RLS. Only for server code that must touch
 * service-only tables (oauth_tokens, send_queue, events, audit_log) and has
 * already authorised the caller.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
