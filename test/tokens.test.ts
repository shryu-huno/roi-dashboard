import { describe, it, expect } from "vitest";
import { tokens } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("exposes the spec palette", () => {
    expect(tokens.color.bg).toBe("#F7F9FC");
    expect(tokens.color.surface).toBe("#FFFFFF");
    expect(tokens.color.primary).toBe("#2563EB");
    expect(tokens.color.fg).toBe("#0F172A");
    expect(tokens.color.muted).toBe("#64748B");
    expect(tokens.color.border).toBe("#E8EDF4");
    expect(tokens.color.success).toBe("#10B981");
    expect(tokens.color.danger).toBe("#F43F5E");
    expect(tokens.color.sidebar).toBe("#0F172A");
    expect(tokens.radius.card).toBe("14px");
  });
});
