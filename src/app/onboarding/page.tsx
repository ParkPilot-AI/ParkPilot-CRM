import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKSPACE_COOKIE } from "@/config/app";
import { requireUser } from "@/lib/auth";
import { getParks } from "@/lib/crm/context";
import { getMemberships } from "@/lib/workspace/current";
import { roleAtLeast } from "@/lib/workspace/roles";
import { SetUpParkForm } from "./form";

export const metadata: Metadata = { title: "Set up your park" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  const memberships = await getMemberships();
  const selected = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = memberships.find((m) => m.workspace.id === selected) ?? memberships[0];
  if (current && (await getParks(current.workspace.id)).length > 0) redirect("/today");
  const canSetUp = !current || roleAtLeast(current.role, "admin");

  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-muted p-6"
    >
      <Logo height={32} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Set up your park</CardTitle>
          <CardDescription>
            {canSetUp
              ? "Tell us the park's name. You can invite your sales team straight after."
              : `${current?.workspace.name} hasn't added a park to ParkPilot CRM yet. Ask your sales manager or an admin to set it up, then sign in again.`}
          </CardDescription>
        </CardHeader>
        {canSetUp ? (
          <CardContent>
            <SetUpParkForm askOperator={!current} />
          </CardContent>
        ) : null}
      </Card>
    </main>
  );
}
