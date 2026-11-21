import { describe, expect, it } from "vitest";
import { buildIcs } from "@/lib/crm/ics";

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "tour-1@parkpilot-crm",
    start: "2026-07-01T10:00:00.000Z",
    end: "2026-07-01T11:00:00.000Z",
    summary: "Park tour: Smith, Jane; lakeside",
    description: "Phone: 07700 900123\nhttps://crm.parkpilot.uk/leads/abc",
  });
  it("uses CRLF and UTC times", () => {
    expect(ics).toContain("\r\nDTSTART:20260701T100000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20260701T110000Z\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("escapes text", () => {
    expect(ics).toContain("SUMMARY:Park tour: Smith\\, Jane\; lakeside");
    expect(ics).toContain("Phone: 07700 900123\\n");
  });
  it("folds long lines to 75 octets", () => {
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
