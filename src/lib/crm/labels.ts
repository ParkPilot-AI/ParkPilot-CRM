import type {
  ActivityType,
  LeadOutcome,
  LeadSource,
  LeadStage,
  TourStatus,
} from "@/lib/supabase/database.types";

/** The four-stage pipeline. A park tour, never a "viewing". */
export const STAGES: readonly { key: LeadStage; label: string; short: string }[] = [
  { key: "enquiry", label: "Enquiry", short: "Enquiry" },
  { key: "appointment", label: "Appointment", short: "Appt" },
  { key: "park_tour", label: "Park Tour", short: "Tour" },
  { key: "closed_sale", label: "Closed Sale", short: "Sale" },
] as const;

export const STAGE_LABEL: Record<LeadStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
) as Record<LeadStage, string>;

export const OUTCOME_LABEL: Record<LeadOutcome, string> = {
  open: "Open",
  won: "Sold",
  lost: "Lost",
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  website_form: "Website form",
  social_media: "Social media",
  advertising: "Advertising",
  email: "Email",
  parkpilot_ai: "ParkPilot AI",
  phone: "Phone call",
  walk_in: "Walk-in",
  referral: "Referral",
  import: "Import",
  other: "Other",
};

/** Sources a person can choose when logging a lead by hand. */
export const MANUAL_SOURCES: LeadSource[] = [
  "phone",
  "walk_in",
  "email",
  "website_form",
  "social_media",
  "advertising",
  "referral",
  "other",
];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  sms: "Text message",
  walk_in: "Walk-in",
  ai_conversation: "ParkPilot AI conversation",
  marketing_reply: "Reply to marketing email",
  stage_change: "Stage changed",
  outcome_change: "Outcome changed",
  assignment: "Reassigned",
  tour: "Park tour",
};

/** Activity types a person can log from a lead page. */
export const LOGGABLE_ACTIVITIES: ActivityType[] = ["note", "call", "email", "sms", "walk_in"];

export const TOUR_STATUS_LABEL: Record<TourStatus, string> = {
  scheduled: "Booked",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export const LOST_REASONS = [
  "Bought elsewhere",
  "Budget",
  "Finance declined",
  "Location",
  "Timing: not ready yet",
  "No longer interested",
  "Couldn't make contact",
  "Other",
] as const;

export const INTERESTS = ["Holiday home", "Lodge", "Not sure yet"] as const;

/** How a person gave marketing consent, recorded on the ecco contact. */
export const CONSENT_METHODS = [
  "Ticked a box on an enquiry form",
  "Asked in person",
  "Asked on the phone",
  "Asked by email",
] as const;
