"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { switchParkAction, switchWorkspaceAction } from "@/app/(app)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type Item = { id: string; name: string };

/** Switch park (and, for people in several operators, operator). */
export function ParkSwitcher({
  park,
  parks,
  workspace,
  workspaces,
}: {
  park: Item;
  parks: Item[];
  workspace: Item;
  workspaces: Item[];
}) {
  const single = parks.length <= 1 && workspaces.length <= 1;
  if (single) {
    return <span className="truncate font-display text-base font-semibold">{park.name}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-64 justify-between gap-2">
          <span className="truncate">{park.name}</span>
          <ChevronsUpDown className="opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Parks</DropdownMenuLabel>
        {parks.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => {
              const fd = new FormData();
              fd.set("parkId", p.id);
              void switchParkAction(fd);
            }}
          >
            <Check className={p.id === park.id ? "opacity-100" : "opacity-0"} aria-hidden />
            <span className="flex-1 truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
        {workspaces.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Operators</DropdownMenuLabel>
            {workspaces.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onSelect={() => {
                  const fd = new FormData();
                  fd.set("workspaceId", w.id);
                  void switchWorkspaceAction(fd);
                }}
              >
                <Check
                  className={w.id === workspace.id ? "opacity-100" : "opacity-0"}
                  aria-hidden
                />
                <span className="flex-1 truncate">{w.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
