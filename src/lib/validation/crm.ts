import { z } from "zod";
import { CONSENT_METHODS, LOST_REASONS } from "@/lib/crm/labels";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((v) => v || null)
  .pipe(z.union([z.null(), z.email("Enter a valid email address")]));

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((v) => v || null)
  .refine(
    (v) => v === null || (/^[0-9 +()-]+$/.test(v) && v.replace(/\D/g, "").length >= 7),
    "Enter a valid phone number",
  );

const optionalMoney = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[£,\s]/g, "") : ""))
  .refine((v) => v === "" || /^\d{1,9}(\.\d{1,2})?$/.test(v), "Enter an amount in pounds")
  .transform((v) => (v === "" ? null : Number(v)));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const uuidOrEmpty = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.union([z.null(), z.uuid()]));

export const leadSourceSchema = z.enum([
  "website_form",
  "social_media",
  "advertising",
  "email",
  "parkpilot_ai",
  "phone",
  "walk_in",
  "referral",
  "import",
  "other",
]);
export const stageSchema = z.enum(["enquiry", "appointment", "park_tour", "closed_sale"]);

const personFields = {
  firstName: optionalText(80),
  lastName: optionalText(80),
  email: optionalEmail,
  phone: optionalPhone,
  postcode: optionalText(12),
};

const hasContactRoute = (v: { email: string | null; phone: string | null }) =>
  Boolean(v.email || v.phone);

export const newLeadSchema = z
  .object({
    ...personFields,
    source: leadSourceSchema,
    sourceDetail: optionalText(200),
    interest: optionalText(60),
    budgetMin: optionalMoney,
    budgetMax: optionalMoney,
    partExchange: checkbox,
    guestToOwner: checkbox,
    assignedTo: uuidOrEmpty,
    note: optionalText(4000),
  })
  .refine(hasContactRoute, {
    message: "Add an email address or a phone number",
    path: ["phone"],
  })
  .refine((v) => Boolean(v.firstName || v.lastName), {
    message: "Add their name",
    path: ["firstName"],
  })
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, {
    message: "The lower figure must be less than the upper one",
    path: ["budgetMax"],
  });

export const updateLeadSchema = z
  .object({
    leadId: z.uuid(),
    ...personFields,
    interest: optionalText(60),
    budgetMin: optionalMoney,
    budgetMax: optionalMoney,
    partExchange: checkbox,
    guestToOwner: checkbox,
    expectedCloseOn: z
      .string()
      .optional()
      .transform((v) => v || null)
      .pipe(z.union([z.null(), z.iso.date()])),
    sourceDetail: optionalText(200),
  })
  .refine(hasContactRoute, {
    message: "Keep an email address or a phone number",
    path: ["phone"],
  })
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, {
    message: "The lower figure must be less than the upper one",
    path: ["budgetMax"],
  });

export const moveStageSchema = z.object({ leadId: z.uuid(), stage: stageSchema });

export const markWonSchema = z.object({ leadId: z.uuid(), saleValue: optionalMoney });

export const markLostSchema = z.object({
  leadId: z.uuid(),
  reason: z.enum(LOST_REASONS),
  detail: optionalText(300),
});

export const leadIdSchema = z.object({ leadId: z.uuid() });

export const assignSchema = z.object({ leadId: z.uuid(), assignedTo: uuidOrEmpty });

export const logActivitySchema = z.object({
  leadId: z.uuid(),
  type: z.enum(["note", "call", "email", "sms", "walk_in"]),
  body: z.string().trim().min(1, "Write something first").max(4000),
});

const dateString = z.iso.date({ error: "Choose a date" });
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a time");

export const newTaskSchema = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1, "Say what needs doing").max(200),
  dueDate: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.union([z.null(), dateString])),
  assignedTo: uuidOrEmpty,
});

export const taskIdSchema = z.object({ taskId: z.uuid() });

export const bookTourSchema = z.object({
  leadId: z.uuid(),
  date: dateString,
  time: timeString,
  duration: z.coerce.number().int().min(15).max(240),
  advisorId: uuidOrEmpty,
  notes: optionalText(1000),
});

export const tourStatusSchema = z.object({
  tourId: z.uuid(),
  status: z.enum(["completed", "no_show", "cancelled"]),
});

export const addToEccoSchema = z.object({
  leadId: z.uuid(),
  consentMethod: z.enum(CONSENT_METHODS),
  consentConfirmed: z.literal("on", { error: "Confirm that they agreed to marketing emails" }),
});

export const parkSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(120),
  timezone: z
    .string()
    .trim()
    .default("Europe/London")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
});

export const updateParkSchema = parkSchema.extend({ parkId: z.uuid() });

export const onboardingSchema = z.object({
  operatorName: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  parkName: z.string().trim().min(2, "Use at least 2 characters").max(120),
});

export const parkStaffSchema = z.object({
  userId: z.uuid(),
  takesLeads: checkbox,
  works: checkbox,
});

export const switchParkSchema = z.object({ parkId: z.uuid() });

/** Body of POST /api/v1/leads (the "lead created" event). */
export const leadApiSchema = z
  .object({
    workspace_id: z.uuid(),
    park_id: z.uuid(),
    email: z.email().max(254).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    first_name: z.string().trim().max(80).optional().nullable(),
    last_name: z.string().trim().max(80).optional().nullable(),
    postcode: z.string().trim().max(12).optional().nullable(),
    source: leadSourceSchema.default("parkpilot_ai"),
    source_detail: z.string().trim().max(200).optional().nullable(),
    external_source: z.string().trim().max(60).optional().nullable(),
    external_id: z.string().trim().max(200).optional().nullable(),
    summary: z.string().trim().max(8000).optional().nullable(),
    transcript_url: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .optional()
      .nullable(),
    channel: z.string().trim().max(40).optional().nullable(),
    interest: z.string().trim().max(60).optional().nullable(),
    part_exchange: z.boolean().optional(),
    guest_to_owner: z.boolean().optional(),
    marketing_consent: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email || v.phone), {
    message: "email or phone is required",
    path: ["email"],
  });
export type LeadApiInput = z.infer<typeof leadApiSchema>;
