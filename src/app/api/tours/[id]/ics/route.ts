import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { displayPhone, personName } from "@/lib/crm/format";
import { buildIcs } from "@/lib/crm/ics";
import { resolvePublicOrigin } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

/** Download a park tour as an .ics file for Outlook, Google Calendar or Apple Calendar. */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/tours/[id]/ics">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await getSessionUser()))
    return new NextResponse("Not found", { status: 404 });
  const db = (await createClient()).schema("crm");
  // RLS: only members of the tour's workspace can read it.
  const { data: tour } = await db
    .from("tours")
    .select(
      "id, starts_at, ends_at, notes, lead_id, park:parks(name), lead:leads(person:people(first_name, last_name, email, phone))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!tour) return new NextResponse("Not found", { status: 404 });

  const person = tour.lead?.person ?? null;
  const name = personName(person);
  const origin = resolvePublicOrigin(request.headers);
  const ics = buildIcs({
    uid: `tour-${tour.id}@parkpilot-crm`,
    start: tour.starts_at,
    end: tour.ends_at,
    summary: `Park tour: ${name}`,
    description: [
      person?.phone ? `Phone: ${displayPhone(person.phone)}` : null,
      person?.email ? `Email: ${person.email}` : null,
      tour.notes,
      `${origin}/leads/${tour.lead_id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    location: tour.park?.name,
    url: `${origin}/leads/${tour.lead_id}`,
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="park-tour-${tour.id.slice(0, 8)}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
