import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches } from "@/lib/crm/api-auth";
import { ConfigError, leadApiSecrets } from "@/lib/env";
import { clientIp } from "@/lib/http/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { leadApiSchema } from "@/lib/validation/crm";

/**
 * "Lead created" event from ParkPilot AI, website forms and other ParkPilot systems.
 *
 *   POST /api/v1/leads
 *   Authorization: Bearer <CRM_LEAD_API_SECRET>
 *   { "workspace_id", "park_id", "email" and/or "phone", "first_name", "summary",
 *     "transcript_url", "external_source", "external_id", ... }
 *
 * Idempotent on (external_source, external_id): resending the same event returns the same lead.
 * A repeat enquiry from someone with an open lead at the park is added to that lead.
 */
export async function POST(request: NextRequest) {
  let secrets: string[];
  try {
    secrets = leadApiSecrets();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      return json({ error: "The lead API isn't set up on this server." }, 503);
    }
    throw err;
  }
  if (!bearerMatches(request.headers.get("authorization"), secrets)) {
    return json({ error: "Unauthorised" }, 401);
  }
  if (!(await rateLimit(`crm-lead-api:${clientIp(request.headers) ?? "unknown"}`, 300, 60))) {
    return json({ error: "Too many requests" }, 429);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "Send JSON (Content-Type: application/json)" }, 415);
  }
  const raw = await request.text();
  if (raw.length > 32_000) return json({ error: "Body too large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body is not valid JSON" }, 400);
  }
  const parsed = leadApiSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: "Invalid lead",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      422,
    );
  }

  const { data, error } = await createAdminClient()
    .schema("crm")
    .rpc("ingest_lead", { p: parsed.data as unknown as Json });
  if (error) {
    if (error.code === "P0002") return json({ error: "Unknown park for this workspace" }, 404);
    if (error.code === "22023" || error.code === "23514")
      return json({ error: error.message }, 422);
    console.error("ingest_lead failed", error.code, error.message);
    return json({ error: "Could not save the lead" }, 500);
  }
  return json({ lead_id: data }, 201);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
