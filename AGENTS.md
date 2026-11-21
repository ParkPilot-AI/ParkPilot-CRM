<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## ParkPilot CRM project notes

- Product name lives in `src/config/app.ts` (`APP_NAME`). Don't hard-code it.
- One Supabase project (`fysaeyexcdpxbfdnqbzl`, eu-west-2) holds ParkPilot ecco (schema `public`) and
  the CRM (schema `crm`). Never change ecco's tables from this repo; coordinate in the ecco repo.
- CRM tables are workspace-scoped with RLS using ecco's `private.is_member()` / `private.has_role()`.
  Add policies in the same migration as the table, and save every migration in `supabase/migrations/`.
- `crm` types in `src/lib/supabase/database.types.ts` are written by hand: update them with each migration.
  The `public` part is copied from ecco.
- Query CRM tables with `supabase.schema("crm")`. Service-role client (`src/lib/supabase/admin.ts`)
  only after authorising the caller (audit log, `/api/v1/leads`).
- Validate every server action / route handler input with Zod (`src/lib/validation/`).
- Wording: British English. "Park tour", never "viewing". Pipeline: Enquiry → Appointment → Park Tour →
  Closed Sale. No plot, stock or site map. Pair automation with human oversight.
- Run `npm run lint && npm run typecheck && npm test && npm run build` before committing.
