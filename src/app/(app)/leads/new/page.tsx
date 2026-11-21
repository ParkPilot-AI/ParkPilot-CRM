import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentPark, getTeam } from "@/lib/crm/context";
import { roleAtLeast } from "@/lib/workspace/roles";
import { NewLeadForm } from "./form";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const ctx = await getCurrentPark();
  if (!roleAtLeast(ctx.role, "editor")) redirect("/leads");
  const team = (await getTeam(ctx.workspace.id)).filter((t) => t.role !== "viewer");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="New lead"
        description={`A phone call, walk-in or other enquiry for ${ctx.park.name}. Website forms and ParkPilot AI add leads automatically.`}
      />
      <Card>
        <CardContent className="pt-6">
          <NewLeadForm
            team={team.map((t) => ({ userId: t.userId, name: t.name }))}
            me={ctx.userId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
