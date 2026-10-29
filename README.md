# ParkPilot CRM

ParkPilot's own sales CRM for tracking holiday park operators from first enquiry to signed customer.
Leads arrive straight from Gmail, demos go into Google Calendar with a Meet link, and the pipeline
runs **Enquiry → Demo booked → Demo held → Proposal sent → Won** (or Lost). Hosted on Netlify,
signed in with Google.

## What it does

- **Leads from Gmail.** Put the `CRM Leads` label on any email (or let a Gmail filter do it). Within
  10 minutes it becomes a lead with a "Reply to…" task for today. Website form emails are read field by
  field (Name, Email, Phone, Park, Units, Role, County, Interested in, Message). Emails from people
  already in the CRM go on their timeline instead. Imported emails move to `CRM Imported`.
- **Park operator details** on every lead: park or group name, job title, units, number of parks,
  area, website, current systems and which product they're interested in.
- **Deals priced in ParkPilot plans** (AI Starter £495 / Professional £995 / Enterprise; CRM Essentials
  £149 / Professional £299 / Group), shown as monthly and annual value.
- **Demos and calls** booked into Google Calendar with a Google Meet link and an invite to the customer.
  Recording a demo moves the deal on and sets the next task automatically.
- **Today**, **Leads**, **Diary**, **Pipeline** and **Overview** pages; works on a phone and installs as an app.
- **One user to start**: whoever is in `OWNER_EMAILS` (or the first person to sign in) is an **Admin**
  with full access to everything. Add sales executives or managers later under Settings → Team.

## How it fits together

| Part | Where |
| --- | --- |
| Web pages | `public/` (plain HTML, CSS and JavaScript – no build step) |
| Server code | `server/` – one request handler shared by everything below |
| Netlify Functions | `netlify/functions/api.mjs` (all `/api/*` and `/auth/*`) and `scheduled.mjs` (every 10 minutes: Gmail check, task rollover) |
| Data | One SQLite database (sql.js) in the site's Netlify Blobs store `parkpilot-crm`, with a daily copy kept for 60 days |
| Sign-in | "Sign in with Google" (OpenID Connect), encrypted 14-day session cookie |
| Google | `server/google.js`: Gmail lead capture (`gmail.modify`) and Google Calendar events (`calendar.events`) |

## Environment variables (Netlify → Site configuration → Environment variables)

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID of the Google Cloud OAuth client (Web application) |
| `GOOGLE_CLIENT_SECRET` | Its client secret |
| `OWNER_EMAILS` | `info@parkpilot.uk` – always an Admin, can never be locked out |
| `GOOGLE_WORKSPACE_DOMAIN` | Optional. `parkpilot.uk` – only accounts on this Workspace can sign in |
| `SESSION_SECRET` | Optional. A long random string for session cookies; defaults to the client secret |

Authorised redirect URIs on the OAuth client:
`https://<your-site>/auth/signin-callback` and `https://<your-site>/api/google/callback`.
Set the OAuth consent screen's user type to **Internal** so no Google verification is needed and
connections don't expire.

Step-by-step setup instructions are in `SETUP.md`.

## Running it locally

```bash
npm install
DEV_FAKE_LOGIN=you@example.com OWNER_EMAILS=you@example.com npm run dev   # http://localhost:8888
npm test
```

`DEV_FAKE_LOGIN` skips Google sign-in for local testing only; it does nothing on Netlify.

## Origin

Adapted from the Coastfields Customer Portal (holiday-home sales CRM): Microsoft sign-in and Outlook
sync replaced with Google; holiday homes, plots and part-exchange replaced with park-operator leads and
ParkPilot plans.
