import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window limiter backed by Postgres (works across serverless instances).
 * Returns true if the call is allowed. Fails open on infrastructure errors so a
 * database hiccup doesn't block legitimate sign-ups; the error is logged.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("hit_rate_limit", {
      p_key: key.slice(0, 200),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.error("rate limiter unavailable", err instanceof Error ? err.message : err);
    return true;
  }
}
