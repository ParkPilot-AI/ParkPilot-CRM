import { z } from "zod";
import { emailSchema } from "./auth";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(120),
});

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  companyName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
  physicalAddress: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  rejectRoleAddresses: z.boolean(),
  sunsetAfterDays: z.coerce.number().int().min(30, "At least 30 days").max(730, "At most 730 days"),
  defaultTimezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
});

const role = z.enum(["owner", "admin", "editor", "viewer"]);

export const inviteSchema = z.object({
  email: emailSchema,
  role: role.exclude(["owner"]),
});

export const changeRoleSchema = z.object({ userId: z.uuid(), role });
export const removeMemberSchema = z.object({ userId: z.uuid() });
export const revokeInviteSchema = z.object({ id: z.uuid() });
export const switchWorkspaceSchema = z.object({ workspaceId: z.uuid() });

/** Flatten Zod errors into { field: [messages] } for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export const testSendSchema = z.object({
  mailboxId: z.uuid(),
  to: emailSchema,
});

export const mailboxIdSchema = z.object({ mailboxId: z.uuid() });

export const mailboxSettingsSchema = z.object({
  mailboxId: z.uuid(),
  displayName: z
    .string()
    .trim()
    .max(80)
    .refine((v) => !/[\r\n<>"]/.test(v), "Can't contain line breaks, quotes or angle brackets")
    .transform((v) => v || null),
});
