import { z } from "zod";

/**
 * Environment variables, validated with Zod.
 *
 * Public values are inlined at build time (NEXT_PUBLIC_*). Server values are read lazily and
 * validated one at a time, so a missing setting only breaks the feature that needs it.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
  /** ParkPilot ecco, for links from a person to their marketing contact. */
  NEXT_PUBLIC_ECCO_URL: z.url().default("https://ecco.parkpilot.uk"),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  NEXT_PUBLIC_ECCO_URL: process.env.NEXT_PUBLIC_ECCO_URL || undefined,
});

export class ConfigError extends Error {
  constructor(
    public readonly variable: string,
    detail: string,
  ) {
    super(`Server setting ${variable} is missing or invalid: ${detail}`);
    this.name = "ConfigError";
  }
}

function assertServer() {
  if (typeof window !== "undefined") throw new Error("Server env read in the browser");
}

function read<T>(name: string, schema: z.ZodType<T>): T {
  assertServer();
  const result = schema.safeParse(process.env[name]);
  if (!result.success) {
    throw new ConfigError(name, result.error.issues[0]?.message ?? "invalid");
  }
  return result.data;
}

/** Supabase secret key (bypasses RLS). Used only for the audit log and the lead API. */
export const supabaseSecretKey = () =>
  read("SUPABASE_SECRET_KEY", z.string({ error: "not set" }).min(20));

/**
 * Shared secret that ParkPilot AI (and other ParkPilot systems) send as a Bearer token to
 * POST /api/v1/leads. Comma-separate several values to rotate without downtime.
 */
export const leadApiSecrets = (): string[] => {
  const list = read("CRM_LEAD_API_SECRET", z.string({ error: "not set" }).min(32))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (list.some((v) => v.length < 32))
    throw new ConfigError("CRM_LEAD_API_SECRET", "each value must be at least 32 characters");
  return list;
};
