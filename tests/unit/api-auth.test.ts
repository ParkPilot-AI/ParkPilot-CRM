import { describe, expect, it } from "vitest";
import { bearerMatches } from "@/lib/crm/api-auth";

const secret = "s".repeat(40);
describe("bearerMatches", () => {
  it("accepts the right secret, including a rotated one", () => {
    expect(bearerMatches(`Bearer ${secret}`, [secret])).toBe(true);
    expect(bearerMatches(`Bearer ${secret}`, ["o".repeat(40), secret])).toBe(true);
  });
  it("rejects anything else", () => {
    expect(bearerMatches(null, [secret])).toBe(false);
    expect(bearerMatches(secret, [secret])).toBe(false);
    expect(bearerMatches("Bearer nope", [secret])).toBe(false);
    expect(bearerMatches(`Basic ${secret}`, [secret])).toBe(false);
  });
});
