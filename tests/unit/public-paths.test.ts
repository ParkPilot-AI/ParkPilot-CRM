import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("isPublicPath", () => {
  it("lets ParkPilot AI reach the lead API and visitors reach sign-in", () => {
    for (const p of ["/", "/api/v1/leads", "/login", "/auth/callback", "/invite/abc"])
      expect(isPublicPath(p)).toBe(true);
  });
  it("keeps the CRM itself behind sign-in", () => {
    for (const p of ["/today", "/leads", "/leads/123", "/api/tours/1/ics", "/settings", "/api/v1x"])
      expect(isPublicPath(p)).toBe(false);
  });
});
