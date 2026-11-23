import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_NAME, authCookieOptions } from "@/lib/supabase/cookie";

describe("authCookieOptions", () => {
  it("shares the sign-in across *.parkpilot.uk", () => {
    for (const host of [
      "ecco.parkpilot.uk",
      "crm.parkpilot.uk",
      "AI.parkpilot.uk:443",
      "ai.parkpilot.uk, proxy",
    ])
      expect(authCookieOptions(host)).toEqual({ name: AUTH_COOKIE_NAME, domain: ".parkpilot.uk" });
  });
  it("keeps it on the host elsewhere", () => {
    for (const host of [
      "ecco-parkpilot.netlify.app",
      "localhost:3000",
      "evilparkpilot.uk",
      "parkpilot.uk.evil.com",
      "",
    ])
      expect(authCookieOptions(host)).toEqual({ name: AUTH_COOKIE_NAME });
  });
});
