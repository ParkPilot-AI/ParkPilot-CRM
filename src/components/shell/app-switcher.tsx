"use client";

import { Check, LayoutGrid } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export type PlatformApp = {
  key: "hub" | "crm" | "ecco";
  label: string;
  description: string;
  href: string;
};

/** Move between ParkPilot apps without signing in again. */
export function AppSwitcher({
  apps,
  current,
}: {
  apps: PlatformApp[];
  current: PlatformApp["key"];
}) {
  const [hub, ...products] = apps;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="ParkPilot apps">
          <LayoutGrid aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem asChild>
          <a href={hub.href} className="font-medium">
            {hub.label}
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Your apps</DropdownMenuLabel>
        {products.map((a) => (
          <DropdownMenuItem key={a.key} asChild>
            <a href={a.href} aria-current={a.key === current ? "page" : undefined}>
              <Check className={a.key === current ? "opacity-100" : "opacity-0"} aria-hidden />
              <span className="grid">
                <span className="font-medium">{a.label}</span>
                <span className="text-xs text-muted-foreground">{a.description}</span>
              </span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
