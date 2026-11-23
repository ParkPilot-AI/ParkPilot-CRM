import "server-only";
import type { PlatformApp } from "@/components/shell/app-switcher";
import { PLATFORM_URLS } from "@/config/app";
import { getWorkspaceProducts } from "./products";

/** Apps for the switcher: the hub always, then the products this workspace has. */
export async function platformApps(workspaceId: string): Promise<PlatformApp[]> {
  const products = await getWorkspaceProducts(workspaceId);
  const has = (p: "crm" | "ecco") => products === null || products.has(p);
  return [
    { key: "hub", label: "ParkPilot home", description: "All your apps", href: PLATFORM_URLS.hub },
    ...(has("crm")
      ? [
          {
            key: "crm" as const,
            label: "ParkPilot CRM",
            description: "Sales leads and park tours",
            href: PLATFORM_URLS.crm,
          },
        ]
      : []),
    ...(has("ecco")
      ? [
          {
            key: "ecco" as const,
            label: "ParkPilot ecco",
            description: "Email marketing",
            href: PLATFORM_URLS.ecco,
          },
        ]
      : []),
  ];
}
