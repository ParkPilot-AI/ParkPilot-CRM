import { describe, expect, it } from "vitest";
import { ago, daysSince, displayPhone, formatBudget, personName } from "@/lib/crm/format";

describe("format", () => {
  it("shows UK numbers in local style", () => {
    expect(displayPhone("+447700900123")).toBe("07700 900123");
    expect(displayPhone("+441754123456")).toBe("01754 123456");
    expect(displayPhone("+442079460000")).toBe("020 7946 0000");
    expect(displayPhone("+33123456789")).toBe("+33123456789");
    expect(displayPhone(null)).toBe("");
  });
  it("names people sensibly", () => {
    expect(personName({ first_name: "Jane", last_name: "Smith" })).toBe("Jane Smith");
    expect(personName({ first_name: null, last_name: null, email: "j@x.com" })).toBe("j@x.com");
    expect(personName(null)).toBe("Unknown");
  });
  it("formats budgets in pounds", () => {
    expect(formatBudget(50000, 90000)).toBe("£50,000–£90,000");
    expect(formatBudget(null, 90000)).toBe("Up to £90,000");
    expect(formatBudget(null, null)).toBe("");
  });
  it("counts days", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(daysSince("2026-11-18T12:00:00Z", now)).toBe(3);
    expect(ago("2026-11-21T08:00:00Z", now)).toBe("today");
    expect(ago("2026-11-07T12:00:00Z", now)).toBe("2 weeks ago");
  });
});
