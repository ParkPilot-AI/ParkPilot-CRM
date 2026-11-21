import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/select";
import { getCurrentPark, getTeam } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, assignableRoles, roleAtLeast } from "@/lib/workspace/roles";
import {
  changeRoleAction,
  removeMemberAction,
  revokeInviteAction,
  setParkStaffAction,
} from "../actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await getCurrentPark();
  const supabase = await createClient();
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const team = await getTeam(ctx.workspace.id);
  const { data: staff } = await supabase
    .schema("crm")
    .from("park_staff")
    .select("user_id, takes_leads")
    .eq("park_id", ctx.park.id);
  const staffMap = new Map((staff ?? []).map((s) => [s.user_id, s.takes_leads]));
  const { data: invites } = isAdmin
    ? await supabase
        .from("workspace_invitations")
        .select("id, email, role, expires_at")
        .eq("workspace_id", ctx.workspace.id)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };
  const roles = assignableRoles(ctx.role);
  const receiving = team.filter((t) => staffMap.get(t.userId) && t.role !== "viewer");

  return (
    <div className="grid gap-6">
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              They sign in with Google or Microsoft using this email address. The same login works
              in ParkPilot ecco.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm roles={roles} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Who works at {ctx.park.name}</CardTitle>
          <CardDescription>
            New leads from your website and ParkPilot AI are shared fairly between the people who
            receive leads: whoever has the fewest open leads gets the next one.
            {receiving.length === 0
              ? " Nobody receives leads at the moment, so new leads arrive unassigned."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {team.map((m) => {
              const works = staffMap.has(m.userId);
              const takes = staffMap.get(m.userId) ?? false;
              const isSelf = m.userId === ctx.userId;
              const canManage =
                !isSelf && roles.length > 0 && (ctx.role === "owner" || m.role !== "owner");
              return (
                <li
                  key={m.userId}
                  className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {m.name}{" "}
                      {isSelf ? <span className="text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[m.role].description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin ? (
                      <form
                        action={setParkStaffAction}
                        className="flex flex-wrap items-center gap-3 text-sm"
                      >
                        <input type="hidden" name="userId" value={m.userId} />
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            name="works"
                            defaultChecked={works}
                            className="size-4 accent-[var(--accent)]"
                          />{" "}
                          Works here
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            name="takesLeads"
                            defaultChecked={takes}
                            disabled={m.role === "viewer"}
                            className="size-4 accent-[var(--accent)]"
                          />{" "}
                          Receives leads
                        </label>
                        <Button size="sm" variant="outline" type="submit">
                          Save
                        </Button>
                      </form>
                    ) : works ? (
                      <Badge variant="outline">{takes ? "Receives leads" : "Works here"}</Badge>
                    ) : null}
                    {canManage ? (
                      <form action={changeRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.userId} />
                        <NativeSelect
                          name="role"
                          defaultValue={m.role}
                          className="h-9 w-40"
                          aria-label={`Role for ${m.name}`}
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r].label}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button size="sm" variant="outline" type="submit">
                          Update
                        </Button>
                      </form>
                    ) : (
                      <Badge variant="secondary">{ROLE_LABELS[m.role].label}</Badge>
                    )}
                    {canManage ? (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button
                          size="sm"
                          variant="ghost"
                          type="submit"
                          className="text-destructive"
                        >
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Roles apply across ParkPilot CRM and ParkPilot ecco. Removing someone removes their
            access to both.
          </p>
        </CardContent>
      </Card>

      {isAdmin && invites?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="flex-1 truncate">{i.email}</span>
                  <Badge variant="outline">{ROLE_LABELS[i.role].label}</Badge>
                  <span className="text-muted-foreground">
                    expires {new Date(i.expires_at).toLocaleDateString("en-GB")}
                  </span>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button size="sm" variant="ghost" type="submit">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
