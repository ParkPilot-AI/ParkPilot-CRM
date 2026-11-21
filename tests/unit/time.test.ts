import { describe, expect, it } from "vitest";
import { addDays, dayBounds, zonedDate, zonedToUtc } from "@/lib/crm/time";

describe("zonedToUtc", () => {
  it("handles GMT (winter)", () => {
    expect(zonedToUtc("2026-11-21", "14:30", "Europe/London").toISOString()).toBe(
      "2026-11-21T14:30:00.000Z",
    );
  });
  it("handles BST (summer)", () => {
    expect(zonedToUtc("2026-07-01", "11:00", "Europe/London").toISOString()).toBe(
      "2026-07-01T10:00:00.000Z",
    );
  });
  it("handles the spring clock change", () => {
    // 29 March 2026: clocks go forward at 01:00 GMT.
    expect(zonedToUtc("2026-03-29", "12:00", "Europe/London").toISOString()).toBe(
      "2026-03-29T11:00:00.000Z",
    );
  });
  it("round-trips with zonedDate", () => {
    const d = zonedToUtc("2026-06-30", "23:30", "Europe/London");
    expect(zonedDate(d, "Europe/London")).toBe("2026-06-30");
  });
});

describe("dayBounds and addDays", () => {
  it("covers the local day", () => {
    const { start, end } = dayBounds(new Date("2026-07-01T12:00:00Z"), "Europe/London");
    expect(start).toBe("2026-06-30T23:00:00.000Z");
    expect(end).toBe("2026-07-01T23:00:00.000Z");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
