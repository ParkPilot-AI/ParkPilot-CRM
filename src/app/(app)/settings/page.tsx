import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentPark } from "@/lib/crm/context";
import { roleAtLeast } from "@/lib/workspace/roles";
import { AddParkForm, ParkForm } from "./forms";

export const metadata: Metadata = { title: "Park settings" };

export default async function SettingsPage() {
  const ctx = await getCurrentPark();
  const isAdmin = roleAtLeast(ctx.role, "admin");
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{ctx.park.name}</CardTitle>
          <CardDescription>Part of {ctx.workspace.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <ParkForm
              park={{ id: ctx.park.id, name: ctx.park.name, timezone: ctx.park.timezone }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask your sales manager to change park settings.
            </p>
          )}
        </CardContent>
      </Card>
      {roleAtLeast(ctx.role, "owner") ? (
        <Card>
          <CardHeader>
            <CardTitle>Parks</CardTitle>
            <CardDescription>
              Running more than one park? Add each one, then switch between them from the top of the
              screen.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="divide-y text-sm">
              {ctx.parks.map((p) => (
                <li key={p.id} className="py-2">
                  {p.name}{" "}
                  {p.id === ctx.park.id ? (
                    <span className="text-muted-foreground">(current)</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <AddParkForm />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
