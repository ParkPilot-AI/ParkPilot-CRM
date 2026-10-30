# Setting up ParkPilot CRM

About 30 minutes, done once. You need: your Google Workspace admin login (info@parkpilot.uk),
a free Netlify account, and access to the ParkPilot-AI GitHub organisation.

---

## Step 1 – Put the CRM on Netlify (10 minutes)

1. Go to **app.netlify.com** and sign in (use "Sign in with GitHub").
2. Click **Add new site → Import an existing project → GitHub**.
3. Pick the **ParkPilot-AI/coastfields-portal** repository and the **parkpilot-crm** branch.
4. Leave the build settings as they are and click **Deploy**.
5. When it finishes, note the web address Netlify gives you, e.g. `https://parkpilot-crm.netlify.app`.
   (Optional: under **Domain management** you can add `crm.parkpilot.uk` instead. If you do, use that
   address everywhere below.)

The site won't let anyone in yet – that's expected until Step 3.

## Step 2 – Create the Google connection (10 minutes)

1. Go to **console.cloud.google.com**, signed in as info@parkpilot.uk.
2. Top bar → project picker → **New project**. Name it `ParkPilot CRM` → **Create**, then select it.
3. Menu → **APIs & Services → Library**. Search for and **Enable** each of:
   - **Gmail API**
   - **Google Calendar API**
4. Menu → **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**) →
   **Get started**:
   - App name: `ParkPilot CRM`; support email: info@parkpilot.uk.
   - Audience / User type: **Internal** ← important (no Google review needed, and the connection
     never expires).
   - Contact email: info@parkpilot.uk → **Create**.
5. Go to **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**; name: `ParkPilot CRM`.
   - Under **Authorised redirect URIs** click **Add URI** twice and enter (with your own address):
     - `https://parkpilot-crm.netlify.app/auth/signin-callback`
     - `https://parkpilot-crm.netlify.app/api/google/callback`
   - Click **Create**. Copy the **Client ID** and **Client secret** somewhere safe for the next step.

## Step 3 – Tell Netlify the keys (3 minutes)

1. In Netlify, open the site → **Site configuration → Environment variables → Add a variable**.
2. Add these four, one at a time:

| Key | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | the Client ID from Step 2 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from Step 2 |
| `OWNER_EMAILS` | `info@parkpilot.uk` |
| `GOOGLE_WORKSPACE_DOMAIN` | `parkpilot.uk` |

3. Go to **Deploys → Trigger deploy → Deploy site** so the new settings take effect.

## Step 4 – Sign in and connect Gmail (2 minutes)

1. Open your CRM address and click **Sign in with Google**, using info@parkpilot.uk.
   You're the **Admin** with full access.
2. Go to **Settings → Gmail and Google Calendar → Connect Gmail and Google Calendar**.
3. On Google's page, **tick every box** and click **Continue**.
4. Back in the CRM you'll see "Connected". Two new labels now appear in Gmail:
   **CRM Leads**, **CRM Imported** and **CRM Not imported**.

## Step 5 – Start getting leads

**By hand:** in Gmail, open an enquiry → label icon → **CRM Leads**. It becomes a lead within
10 minutes (or click **Check Gmail now** in Settings).

**Automatically (recommended) – website form emails:**
1. In Gmail, search for one of your Book a Demo emails (e.g. `subject:"Book a Demo"`).
2. Click the **Show search options** icon in the search bar → **Create filter**.
3. Tick **Apply the label: CRM Leads** → **Create filter**.
Every future form email is now turned into a lead with the name, park, units and message filled in.

What happens to each email:
- New person → new lead in **Enquiry**, with a **Reply to…** task due today.
- Someone already in the CRM → added to their timeline (with an **Open in Gmail** link).
- The email moves from **CRM Leads** to **CRM Imported**, so it's never imported twice.
- No name, or no email address or phone number → **not** imported. It moves to **CRM Not imported**
  so you can check it; if it's a real enquiry, add the person with **+ New → Lead**.

## Everyday use

- **Today** – your tasks, today's diary, new leads and proposals waiting.
- **Book** a demo from a lead's page → it goes into your Google Calendar with a Meet link, and the
  customer gets an invite. The deal moves to **Demo booked**.
- After the demo, click **Record outcome** → choose the plan and monthly price. The deal moves to
  **Demo held** (or **Proposal sent**) and the next task is set for you.
- Mark a deal **Won** from its card; onboarding tasks are added.
- Have an existing list of leads? **Settings → Import** takes a CSV or Excel file.

## If something goes wrong

| You see | Do this |
| --- | --- |
| "Sign-in isn't set up yet" | Check the Step 3 variables, then redeploy. |
| Google says "redirect_uri_mismatch" | The addresses in Step 2.5 must match your CRM address exactly (https, no trailing slash). |
| "Google didn't give permission…" | Connect again and tick every box. |
| "Google access has expired" | Settings → Disconnect → Connect again. |
| Labelled emails not arriving | Settings → **Check Gmail now**; any problem is shown in red there. |

## Adding people later

**Settings → Team → + Add person** with their @parkpilot.uk address and a role:
Sales Executive (own leads), Sales Manager (all leads and settings) or Admin (everything).
They then sign in with Google and click **Connect** in Settings for their own Gmail.
