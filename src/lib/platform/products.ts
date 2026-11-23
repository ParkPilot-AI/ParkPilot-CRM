import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProductKey } from "@/lib/supabase/database.types";

/**
 * Products switched on for a workspace (public.workspace_products, managed by ParkPilot staff in
 * the hub). Returns null if the table can't be read yet, so callers can show everything rather
 * than hide products by mistake.
 */
export const getWorkspaceProducts = cache(
  async (workspaceId: string): Promise<Set<ProductKey> | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspace_products")
      .select("product, status, ends_at")
      .eq("workspace_id", workspaceId);
    if (error) return null;
    const now = new Date().getTime();
    return new Set(
      (data ?? [])
        .filter(
          (p) =>
            (p.status === "trial" || p.status === "active") &&
            (!p.ends_at || new Date(p.ends_at).getTime() > now),
        )
        .map((p) => p.product),
    );
  },
);
