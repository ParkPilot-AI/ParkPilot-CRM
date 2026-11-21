/**
 * Supabase database types.
 *
 * One Supabase project (fysaeyexcdpxbfdnqbzl) holds ParkPilot ecco (schema `public`) and
 * ParkPilot CRM (schema `crm`). The `public` part is copied from the ecco repo; keep it in step
 * when ecco's tables change. The `crm` part is written by hand from supabase/migrations.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type WorkspaceRow = {
  bounce_rate_threshold: number;
  company_name: string | null;
  complaint_rate_threshold: number;
  created_at: string;
  created_by: string | null;
  default_timezone: string;
  id: string;
  name: string;
  physical_address: string | null;
  reject_role_addresses: boolean;
  slug: string;
  sunset_after_days: number;
  updated_at: string;
};

type Role = "owner" | "admin" | "editor" | "viewer";

export type MailboxStatus = "connected" | "needs_reauth" | "paused" | "disabled" | "error";

export type MailboxRow = {
  id: string;
  workspace_id: string;
  provider: "google" | "microsoft";
  email: string;
  display_name: string | null;
  status: MailboxStatus;
  last_error: string | null;
  per_minute_cap: number;
  per_day_cap: number;
  warmup_enabled: boolean;
  warmup_started_at: string | null;
  paused_until: string | null;
  paused_reason: string | null;
  sync_cursor: string | null;
  last_synced_at: string | null;
  push_subscription_id: string | null;
  push_expires_at: string | null;
  sync_locked_until: string | null;
  sync_error: string | null;
  push_error: string | null;
  sync_stats: Json | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactStatus = "subscribed" | "unsubscribed" | "bounced" | "complained" | "pending";
export type SuppressionReason = "unsubscribed" | "hard_bounce" | "complaint" | "manual" | "erased" | "role_address";

export type ContactRow = {
  id: string;
  workspace_id: string;
  email: string;
  email_normalized: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  custom_fields: Json;
  tags: string[];
  flags: string[];
  status: ContactStatus;
  consent_source: string | null;
  consent_at: string | null;
  consent_ip: unknown;
  consent_form: string | null;
  consent_confirmed_by: string | null;
  last_sent_at: string | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  last_replied_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SuppressionRow = {
  id: string;
  workspace_id: string;
  email_hash: string;
  email: string | null;
  reason: SuppressionReason;
  source: string | null;
  created_by: string | null;
  created_at: string;
};

export type CustomFieldRow = {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  fallback: string | null;
  created_at: string;
};

export type GroupRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  double_opt_in: boolean;
  signup_form_enabled: boolean;
  signup_form_settings: Json;
  public_id: string;
  confirmation_mailbox_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactImportRow = {
  id: string;
  workspace_id: string;
  filename: string;
  total_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  flagged_count: number;
  group_ids: string[];
  tags: string[];
  consent_source: string;
  consent_statement: string;
  consented_by: string;
  consent_ip: unknown;
  report: Json;
  created_at: string;
};

export type ImageRow = {
  id: string;
  workspace_id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  alt_text: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  editor_mode: "blocks" | "html";
  current_version_id: string | null;
  is_starter: boolean;
  starter_key: string | null;
  thumbnail_text: string | null;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateVersionRow = {
  id: string;
  template_id: string;
  workspace_id: string;
  version: number;
  blocks: Json | null;
  mjml: string | null;
  html: string | null;
  text_body: string | null;
  compliance: Json;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type CampaignStatus = "draft" | "scheduled" | "sending" | "paused" | "sent" | "cancelled" | "failed";

export type CampaignRow = {
  id: string;
  workspace_id: string;
  name: string;
  subject: string | null;
  preview_text: string | null;
  mailbox_id: string | null;
  reply_to: string | null;
  template_id: string | null;
  template_version_id: string | null;
  html_snapshot: string | null;
  text_snapshot: string | null;
  audience: Json;
  ab_test: Json;
  status: CampaignStatus;
  scheduled_at: string | null;
  timezone: string;
  track_opens: boolean;
  track_clicks: boolean;
  apply_sunset: boolean;
  link_check: Json | null;
  recipient_count: number;
  paused_reason: string | null;
  paused_at: string | null;
  last_error: string | null;
  test_sent_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  scheduled_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type DomainCheckRow = {
  id: string;
  workspace_id: string;
  domain: string;
  spf_status: CheckStatus;
  dkim_status: CheckStatus;
  dmarc_status: CheckStatus;
  details: Json;
  checked_at: string | null;
  created_at: string;
};

export type InboxClassification = "reply" | "out_of_office" | "bounce" | "unsubscribe" | "complaint" | "other";
export type InboxMessageRow = {
  id: string;
  workspace_id: string;
  mailbox_id: string;
  provider_message_id: string;
  provider_thread_id: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references: string[];
  from_email: string | null;
  from_name: string | null;
  to_emails: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string;
  classification: InboxClassification;
  campaign_id: string | null;
  campaign_recipient_id: string | null;
  contact_id: string | null;
  is_read: boolean;
  archived_at: string | null;
  bounce_kind: "hard" | "soft" | "block" | "delayed" | null;
  bounced_email: string | null;
  action_taken: string | null;
  replied_at: string | null;
  web_link: string | null;
  created_at: string;
};

export type RecipientRow = {
  id: string;
  campaign_id: string;
  workspace_id: string;
  contact_id: string | null;
  email: string;
  variant: string | null;
  status: "queued" | "sent" | "failed" | "bounced" | "skipped_suppressed" | "skipped_other";
  message_id: string | null;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  sent_at: string | null;
  error: string | null;
  first_opened_at: string | null;
  first_clicked_at: string | null;
  replied_at: string | null;
  created_at: string;
};

export type SendJobRow = {
  id: number;
  workspace_id: string;
  campaign_id: string;
  campaign_recipient_id: string;
  mailbox_id: string;
  status: "pending" | "processing" | "sent" | "retry" | "dead";
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type OAuthTokenRow = {
  mailbox_id: string;
  workspace_id: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
  scopes: string[];
  key_version: number;
  updated_at: string;
};

type EccoDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      workspaces: {
        Row: WorkspaceRow;
        Insert: Partial<WorkspaceRow> & { name: string; slug: string };
        Update: Partial<WorkspaceRow>;
        Relationships: [];
      };
      members: {
        Row: { created_at: string; role: Role; user_id: string; workspace_id: string };
        Insert: { created_at?: string; role?: Role; user_id: string; workspace_id: string };
        Update: { created_at?: string; role?: Role; user_id?: string; workspace_id?: string };
        Relationships: [
          {
            foreignKeyName: "members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_invitations: {
        Row: {
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Role;
          token_hash: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Role;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          expires_at?: string;
          role?: Role;
        };
        Relationships: [];
      };
      domain_checks: {
        Row: DomainCheckRow;
        Insert: Partial<DomainCheckRow> & { workspace_id: string; domain: string };
        Update: Partial<DomainCheckRow>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: number;
          metadata: Json;
          target_id: string | null;
          target_type: string | null;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          metadata?: Json;
          target_id?: string | null;
          target_type?: string | null;
          workspace_id: string;
        };
        Update: never;
        Relationships: [];
      };
      mailboxes: {
        Row: MailboxRow;
        Insert: Partial<MailboxRow> & {
          workspace_id: string;
          provider: "google" | "microsoft";
          email: string;
        };
        Update: Partial<MailboxRow>;
        Relationships: [];
      };
      oauth_tokens: {
        Row: OAuthTokenRow;
        Insert: Partial<OAuthTokenRow> & {
          mailbox_id: string;
          workspace_id: string;
          encrypted_refresh_token: string;
        };
        Update: Partial<OAuthTokenRow>;
        Relationships: [];
      };
      suppression_list: {
        Row: SuppressionRow;
        Insert: Partial<SuppressionRow> & {
          workspace_id: string;
          reason: SuppressionReason;
          email_hash: string;
        };
        Update: never;
        Relationships: [];
      };
      contacts: {
        Row: ContactRow;
        Insert: Partial<Omit<ContactRow, "email_normalized">> & { workspace_id: string; email: string };
        Update: Partial<Omit<ContactRow, "email_normalized">>;
        Relationships: [];
      };
      contact_custom_fields: {
        Row: CustomFieldRow;
        Insert: Partial<CustomFieldRow> & { workspace_id: string; key: string; label: string };
        Update: Partial<CustomFieldRow>;
        Relationships: [];
      };
      groups: {
        Row: GroupRow;
        Insert: Partial<GroupRow> & { workspace_id: string; name: string };
        Update: Partial<GroupRow>;
        Relationships: [];
      };
      group_members: {
        Row: { group_id: string; contact_id: string; workspace_id: string; added_at: string };
        Insert: { group_id: string; contact_id: string; workspace_id: string; added_at?: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "group_members_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      segments: {
        Row: { id: string; workspace_id: string; name: string; rules: Json; created_at: string; updated_at: string };
        Insert: { workspace_id: string; name: string; rules?: Json };
        Update: { name?: string; rules?: Json };
        Relationships: [];
      };
      contact_imports: {
        Row: ContactImportRow;
        Insert: Partial<ContactImportRow> & {
          workspace_id: string;
          filename: string;
          consent_source: string;
          consent_statement: string;
          consented_by: string;
        };
        Update: { created_count?: number; updated_count?: number };
        Relationships: [];
      };
      subscription_confirmations: {
        Row: {
          id: string;
          workspace_id: string;
          group_id: string;
          contact_id: string;
          token_hash: string;
          expires_at: string;
          confirmed_at: string | null;
          request_ip: unknown;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          group_id: string;
          contact_id: string;
          token_hash: string;
          expires_at?: string;
          request_ip?: string | null;
          user_agent?: string | null;
        };
        Update: { confirmed_at?: string | null };
        Relationships: [];
      };
      images: {
        Row: ImageRow;
        Insert: Omit<ImageRow, "id" | "created_at" | "updated_at"> & { id?: string };
        Update: { alt_text?: string | null };
        Relationships: [];
      };
      templates: {
        Row: TemplateRow;
        Insert: Partial<TemplateRow> & { workspace_id: string; name: string };
        Update: Partial<Pick<TemplateRow, "name" | "description" | "archived_at" | "editor_mode">>;
        Relationships: [
          {
            foreignKeyName: "templates_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "template_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      template_versions: {
        Row: TemplateVersionRow;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "template_versions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "templates";
            referencedColumns: ["id"];
          },
        ];
      };
      inbox_messages: {
        Row: InboxMessageRow;
        Insert: Partial<InboxMessageRow> & {
          workspace_id: string;
          mailbox_id: string;
          provider_message_id: string;
          received_at: string;
        };
        Update: Partial<Pick<InboxMessageRow, "is_read" | "archived_at" | "classification" | "action_taken" | "replied_at" | "contact_id">>;
        Relationships: [];
      };
      campaign_recipients: {
        Row: RecipientRow;
        Insert: never;
        Update: Partial<Omit<RecipientRow, "id" | "workspace_id" | "campaign_id">>;
        Relationships: [];
      };
      events: {
        Row: {
          id: number;
          workspace_id: string;
          campaign_id: string | null;
          campaign_recipient_id: string | null;
          contact_id: string | null;
          type: string;
          metadata: Json;
          occurred_at: string;
        };
        Insert: {
          workspace_id: string;
          campaign_id?: string | null;
          campaign_recipient_id?: string | null;
          contact_id?: string | null;
          type: "sent" | "delivered" | "bounce" | "open" | "click" | "unsubscribe" | "reply" | "complaint" | "failed";
          metadata?: Json;
        };
        Update: never;
        Relationships: [];
      };
      campaigns: {
        Row: CampaignRow;
        Insert: Partial<CampaignRow> & { workspace_id: string; name: string };
        Update: Partial<Omit<CampaignRow, "id" | "workspace_id" | "created_at">>;
        Relationships: [];
      };
      send_queue: {
        Row: SendJobRow;
        Insert: never;
        Update: Partial<Pick<SendJobRow, "status" | "run_at" | "last_error" | "locked_at" | "locked_by" | "attempts">>;
        Relationships: [];
      };
      mailbox_send_log: {
        Row: { id: number; mailbox_id: string; workspace_id: string; kind: string; sent_at: string };
        Insert: { mailbox_id: string; workspace_id: string; kind: "campaign" | "test" | "confirmation" | "alert" | "reply" };
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      save_template_version: {
        Args: {
          p_template: string;
          p_blocks: Json | null;
          p_mjml: string | null;
          p_html: string;
          p_text: string;
          p_compliance: Json;
          p_note?: string | null;
        };
        Returns: TemplateVersionRow;
        SetofOptions: { from: "*"; to: "template_versions"; isOneToOne: true; isSetofReturn: false };
      };
      campaign_audience: {
        Args: { p_campaign: string };
        Returns: ContactRow[];
        SetofOptions: { from: "*"; to: "contacts"; isOneToOne: false; isSetofReturn: true };
      };
      enqueue_campaign: { Args: { p_campaign: string }; Returns: number };
      workspace_overview: { Args: { p_workspace: string; p_days?: number }; Returns: Json };
      campaign_stats: {
        Args: { p_workspace: string; p_limit?: number };
        Returns: {
          id: string;
          name: string;
          status: CampaignStatus;
          started_at: string | null;
          completed_at: string | null;
          track_opens: boolean;
          track_clicks: boolean;
          recipients: number;
          sent: number;
          bounced: number;
          opened: number;
          clicked: number;
          replied: number;
          unsubscribed: number;
          complaints: number;
        }[];
      };
      purge_operational_data: { Args: Record<string, never>; Returns: Json };
      claim_mailbox_sync: { Args: { p_mailbox: string; p_seconds: number }; Returns: boolean };
      release_mailbox_sync: { Args: { p_mailbox: string }; Returns: undefined };
      claim_send_jobs: {
        Args: { p_mailbox: string; p_limit: number; p_worker: string };
        Returns: SendJobRow[];
        SetofOptions: { from: "*"; to: "send_queue"; isOneToOne: false; isSetofReturn: true };
      };
      reap_stale_jobs: { Args: Record<string, never>; Returns: number };
      campaign_progress: { Args: { p_campaign: string }; Returns: Json };
      mailbox_usage: { Args: { p_workspace: string }; Returns: { mailbox_id: string; last_minute: number; last_day: number }[] };
      hit_rate_limit: { Args: { p_key: string; p_limit: number; p_window_seconds: number }; Returns: boolean };
      segment_contacts: {
        Args: { p_workspace: string; p_rules: Json };
        Returns: ContactRow[];
        SetofOptions: { from: "*"; to: "contacts"; isOneToOne: false; isSetofReturn: true };
      };
      create_workspace: {
        Args: { p_name: string; p_slug: string };
        Returns: WorkspaceRow;
        SetofOptions: { from: "*"; to: "workspaces"; isOneToOne: true; isSetofReturn: false };
      };
    };
    Enums: {
      workspace_role: Role;
      mailbox_provider: "google" | "microsoft";
      contact_status: "subscribed" | "unsubscribed" | "bounced" | "complained" | "pending";
      campaign_status: "draft" | "scheduled" | "sending" | "paused" | "sent" | "cancelled" | "failed";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type WorkspaceRole = Role;
export type Workspace = WorkspaceRow;

/* ------------------------------------------------------------------ CRM (schema crm) */

export type LeadStage = "enquiry" | "appointment" | "park_tour" | "closed_sale";
export type LeadOutcome = "open" | "won" | "lost";
export type LeadSource =
  | "website_form"
  | "social_media"
  | "advertising"
  | "email"
  | "parkpilot_ai"
  | "phone"
  | "walk_in"
  | "referral"
  | "import"
  | "other";
export type ActivityType =
  | "note"
  | "call"
  | "email"
  | "sms"
  | "walk_in"
  | "ai_conversation"
  | "marketing_reply"
  | "stage_change"
  | "outcome_change"
  | "assignment"
  | "tour";
export type TourStatus = "scheduled" | "completed" | "no_show" | "cancelled";

export type ParkRow = {
  id: string;
  workspace_id: string;
  name: string;
  timezone: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type ParkStaffRow = {
  park_id: string;
  workspace_id: string;
  user_id: string;
  takes_leads: boolean;
  created_at: string;
};

export type PersonRow = {
  id: string;
  workspace_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  postcode: string | null;
  is_owner: boolean;
  owner_since: string | null;
  contact_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadRow = {
  id: string;
  workspace_id: string;
  park_id: string;
  person_id: string;
  stage: LeadStage;
  outcome: LeadOutcome;
  lost_reason: string | null;
  source: LeadSource;
  source_detail: string | null;
  external_source: string | null;
  external_id: string | null;
  assigned_to: string | null;
  interest: string | null;
  budget_min: number | null;
  budget_max: number | null;
  part_exchange: boolean;
  guest_to_owner: boolean;
  expected_close_on: string | null;
  sale_value: number | null;
  stage_changed_at: string;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityRow = {
  id: number;
  workspace_id: string;
  lead_id: string | null;
  person_id: string | null;
  type: ActivityType;
  body: string | null;
  metadata: Json;
  created_by: string | null;
  occurred_at: string;
};

export type TaskRow = {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  person_id: string | null;
  title: string;
  details: string | null;
  due_at: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TourRow = {
  id: string;
  workspace_id: string;
  park_id: string;
  lead_id: string;
  advisor_id: string | null;
  starts_at: string;
  ends_at: string;
  status: TourStatus;
  mailbox_id: string | null;
  calendar_event_id: string | null;
  reminder_sent_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type Ins<Row, Required extends keyof Row, Generated extends keyof Row = never> = Partial<
  Omit<Row, Generated>
> &
  Pick<Row, Required>;

type CrmSchema = {
  Tables: {
    parks: {
      Row: ParkRow;
      Insert: Ins<ParkRow, "workspace_id" | "name">;
      Update: Partial<Pick<ParkRow, "name" | "timezone" | "active">>;
      Relationships: [];
    };
    park_staff: {
      Row: ParkStaffRow;
      Insert: Ins<ParkStaffRow, "park_id" | "workspace_id" | "user_id">;
      Update: Partial<Pick<ParkStaffRow, "takes_leads">>;
      Relationships: [
        {
          foreignKeyName: "park_staff_park_id_workspace_id_fkey";
          columns: ["park_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "parks";
          referencedColumns: ["id", "workspace_id"];
        },
      ];
    };
    people: {
      Row: PersonRow;
      Insert: Ins<PersonRow, "workspace_id", "email_normalized" | "contact_id">;
      Update: Partial<Omit<PersonRow, "id" | "workspace_id" | "email_normalized" | "contact_id">>;
      Relationships: [];
    };
    leads: {
      Row: LeadRow;
      Insert: Ins<LeadRow, "workspace_id" | "park_id" | "person_id">;
      Update: Partial<Omit<LeadRow, "id" | "workspace_id" | "created_at">>;
      Relationships: [
        {
          foreignKeyName: "leads_person_id_workspace_id_fkey";
          columns: ["person_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "people";
          referencedColumns: ["id", "workspace_id"];
        },
        {
          foreignKeyName: "leads_park_id_workspace_id_fkey";
          columns: ["park_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "parks";
          referencedColumns: ["id", "workspace_id"];
        },
      ];
    };
    activities: {
      Row: ActivityRow;
      Insert: Ins<ActivityRow, "workspace_id" | "type", "id">;
      Update: Partial<Pick<ActivityRow, "body">>;
      Relationships: [
        {
          foreignKeyName: "activities_lead_id_workspace_id_fkey";
          columns: ["lead_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "leads";
          referencedColumns: ["id", "workspace_id"];
        },
        {
          foreignKeyName: "activities_person_id_workspace_id_fkey";
          columns: ["person_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "people";
          referencedColumns: ["id", "workspace_id"];
        },
      ];
    };
    tasks: {
      Row: TaskRow;
      Insert: Ins<TaskRow, "workspace_id" | "title">;
      Update: Partial<Omit<TaskRow, "id" | "workspace_id" | "created_at">>;
      Relationships: [
        {
          foreignKeyName: "tasks_lead_id_workspace_id_fkey";
          columns: ["lead_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "leads";
          referencedColumns: ["id", "workspace_id"];
        },
        {
          foreignKeyName: "tasks_person_id_workspace_id_fkey";
          columns: ["person_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "people";
          referencedColumns: ["id", "workspace_id"];
        },
      ];
    };
    tours: {
      Row: TourRow;
      Insert: Ins<TourRow, "workspace_id" | "park_id" | "lead_id" | "starts_at" | "ends_at">;
      Update: Partial<Omit<TourRow, "id" | "workspace_id" | "created_at">>;
      Relationships: [
        {
          foreignKeyName: "tours_lead_id_workspace_id_fkey";
          columns: ["lead_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "leads";
          referencedColumns: ["id", "workspace_id"];
        },
        {
          foreignKeyName: "tours_park_id_workspace_id_fkey";
          columns: ["park_id", "workspace_id"];
          isOneToOne: false;
          referencedRelation: "parks";
          referencedColumns: ["id", "workspace_id"];
        },
      ];
    };
  };
  Views: { [_ in never]: never };
  Functions: {
    ingest_lead: { Args: { p: Json }; Returns: string };
    pick_advisor: { Args: { p_park: string }; Returns: string | null };
    normalize_phone: { Args: { p: string }; Returns: string | null };
  };
  Enums: {
    lead_stage: LeadStage;
    lead_outcome: LeadOutcome;
    lead_source: LeadSource;
    activity_type: ActivityType;
    tour_status: TourStatus;
  };
  CompositeTypes: { [_ in never]: never };
};

export type Database = EccoDatabase & { crm: CrmSchema };
