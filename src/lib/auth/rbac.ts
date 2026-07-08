export type AppRole = "ADMIN" | "SETTLEMENT" | "PM";

const RANK: Record<AppRole, number> = { ADMIN: 3, SETTLEMENT: 2, PM: 1 };

export function hasAtLeast(
  role: AppRole | null | undefined,
  required: AppRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[required];
}

export function canManageUsers(role: AppRole | null | undefined): boolean {
  return role === "ADMIN";
}

export function canEditSettlement(role: AppRole | null | undefined): boolean {
  return hasAtLeast(role, "SETTLEMENT");
}
