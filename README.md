# Coastfields Customer Portal

Sales CRM for Coastfields holiday home sales and part-exchanges: contacts, deals, diary, tasks with
overnight rollover, and two-way Microsoft Outlook sync. Hosted on Netlify, signed in with your
organisation's Microsoft accounts.

## How it fits together

| Part | Where |
| --- | --- |
| Web pages | `public/` (plain HTML, CSS and JavaScript – no build step) |
| Server code | `server/` – one request handler shared by everything below |
| Netlify Functions | `netlify/functions/api.mjs` (all `/api/*` and `/auth/*` requests) and `scheduled.mjs` (every 10 minutes) |
| Data | One SQLite database (via sql.js) saved in the site's Netlify Blobs store `coastfields`, with a daily copy kept for 60 days |
| Sign-in | "Sign in with Microsoft" (OpenID Connect) using your Entra app registration; encrypted 14-day session cookie |
| Outlook | Microsoft Graph: events pushed on save, live change notifications to `/api/graph/notify`, delta checks every 10 minutes, tasks mirrored to Microsoft To Do |

## Environment variables (Netlify → Site configuration → Environment variables)

| Name | Value |
| --- | --- |
| `GRAPH_CLIENT_ID` | Application (client) ID of the Entra app registration |
| `GRAPH_CLIENT_SECRET` | Client secret value from the app registration (expires after 24 months – renew before then) |
| `GRAPH_TENANT_ID` | Directory (tenant) ID of your Microsoft 365 organisation |
| `OWNER_EMAILS` | Comma-separated work emails allowed to use the portal |
| `SESSION_SECRET` | Optional. A long random string for session cookies; defaults to the client secret |

Redirect URIs on the app registration (platform **Web**):
`https://<your-site>/auth/signin-callback` and `https://<your-site>/api/auth/callback`.

## Running it locally

```bash
npm install
DEV_FAKE_LOGIN=you@example.com OWNER_EMAILS=you@example.com npm run dev   # http://localhost:8888
npm test
```

`DEV_FAKE_LOGIN` skips Microsoft sign-in for local testing only; it does nothing on Netlify.

## Customer data

The contacts spreadsheet is never stored in this repository. Import it from the portal
(Today → Welcome, or Settings → Import) after signing in.
