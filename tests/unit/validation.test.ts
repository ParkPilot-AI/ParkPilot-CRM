import { describe, expect, it } from "vitest";
import { leadApiSchema, newLeadSchema } from "@/lib/validation/crm";

const ids = {
  workspace_id: "6f1c1c1e-1b1a-4c1a-9a1a-1a1a1a1a1a1a",
  park_id: "7f1c1c1e-1b1a-4c1a-9a1a-1a1a1a1a1a1a",
};

describe("leadApiSchema", () => {
  it("accepts a ParkPilot AI lead and defaults the source", () => {
    const r = leadApiSchema.safeParse({ ...ids, email: "jane@example.com", summary: "Lodges" });
    expect(r.success).toBe(true);
    expect(r.data?.source).toBe("parkpilot_ai");
  });
  it("needs an email or phone", () => {
    expect(leadApiSchema.safeParse({ ...ids, first_name: "Jane" }).success).toBe(false);
  });
  it("rejects unknown fields and non-https transcript links", () => {
    expect(leadApiSchema.safeParse({ ...ids, phone: "07700900123", admin: true }).success).toBe(
      false,
    );
    expect(
      leadApiSchema.safeParse({
        ...ids,
        phone: "07700900123",
        transcript_url: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      leadApiSchema.safeParse({ ...ids, phone: "07700900123", transcript_url: "http://x.com" })
        .success,
    ).toBe(false);
  });
});

describe("newLeadSchema", () => {
  const base = { source: "walk_in", firstName: "Jane" };
  it("needs a name and a contact route", () => {
    expect(newLeadSchema.safeParse(base).success).toBe(false);
    expect(newLeadSchema.safeParse({ ...base, phone: "07700 900123" }).success).toBe(true);
    expect(newLeadSchema.safeParse({ source: "phone", phone: "07700 900123" }).success).toBe(false);
  });
  it("parses budgets in pounds", () => {
    const r = newLeadSchema.safeParse({
      ...base,
      phone: "07700900123",
      budgetMin: "£50,000",
      budgetMax: "90000",
    });
    expect(r.data?.budgetMin).toBe(50000);
    expect(
      newLeadSchema.safeParse({
        ...base,
        phone: "07700900123",
        budgetMin: "90000",
        budgetMax: "50000",
      }).success,
    ).toBe(false);
  });
  it("reads checkboxes", () => {
    const r = newLeadSchema.safeParse({ ...base, email: "j@example.com", partExchange: "on" });
    expect(r.data?.partExchange).toBe(true);
    expect(r.data?.guestToOwner).toBe(false);
  });
});
