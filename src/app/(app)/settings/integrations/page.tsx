import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentPark } from "@/lib/crm/context";
import { publicEnv } from "@/lib/env";
import { requestOrigin } from "@/lib/request";
import { roleAtLeast } from "@/lib/workspace/roles";

export const metadata: Metadata = { title: "Connections" };

export default async function IntegrationsPage() {
  const ctx = await getCurrentPark();
  const origin = await requestOrigin();
  const example = JSON.stringify(
    {
      workspace_id: ctx.workspace.id,
      park_id: ctx.park.id,
      first_name: "Jane",
      last_name: "Smith",
      email: "jane@example.com",
      phone: "07700 900123",
      source: "parkpilot_ai",
      channel: "website",
      external_source: "parkpilot-widget",
      external_id: "<conversation id>",
      summary: "Asked about lakeside lodges and part-exchange.",
      transcript_url: "https://…",
    },
    null,
    2,
  );
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>ParkPilot AI</CardTitle>
          <CardDescription>
            When AI Owner Services captures an ownership enquiry, it sends the lead here with a
            summary of the conversation. Your team reviews and follows up; nothing is sent to the
            customer automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Workspace ID</dt>
            <dd className="break-all font-mono text-xs">{ctx.workspace.id}</dd>
            <dt className="text-muted-foreground">Park ID</dt>
            <dd className="break-all font-mono text-xs">{ctx.park.id}</dd>
          </dl>
          {roleAtLeast(ctx.role, "admin") ? (
            <details>
              <summary className="cursor-pointer font-medium text-accent-text">
                Technical details for ParkPilot
              </summary>
              <div className="mt-3 grid gap-2">
                <p>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    POST {origin}/api/v1/leads
                  </code>{" "}
                  with{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    Authorization: Bearer &lt;CRM_LEAD_API_SECRET&gt;
                  </code>
                </p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{example}</pre>
                <p className="text-xs text-muted-foreground">
                  Sending the same external_id twice never creates a second lead. If the person
                  already has an open lead at this park, the enquiry is added to it.
                </p>
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ParkPilot ecco</CardTitle>
          <CardDescription>
            Email marketing from your own mailbox. ecco and the CRM share one login and one list of
            people: when someone in the CRM is also an ecco contact, their marketing status and
            campaign activity show on their lead, and unsubscribes are respected everywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href={publicEnv.NEXT_PUBLIC_ECCO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
          >
            Open ParkPilot ecco <ExternalLink className="size-3" aria-hidden />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
