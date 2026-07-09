"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/auth/rbac";

/** DB 반영 코어 (테스트 대상, 세션 비의존). */
export async function applyApproval(input: {
  userId: string;
  role: AppRole;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.user.updateMany({
    where: { id: input.userId },
    data: { status: "ACTIVE", role: input.role },
  });
  if (result.count === 0) return { ok: false, error: "사용자를 찾을 수 없습니다." };
  return { ok: true };
}

export async function applyStatus(input: {
  userId: string;
  status: "ACTIVE" | "INACTIVE";
}): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.user.updateMany({
    where: { id: input.userId },
    data: { status: input.status },
  });
  if (result.count === 0) return { ok: false, error: "사용자를 찾을 수 없습니다." };
  return { ok: true };
}

/** 폼에서 호출하는 server action (ADMIN 전용). */
export async function approveUser(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as AppRole;
  await applyApproval({ userId, role });
  revalidatePath("/admin/users");
}

export async function changeStatus(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const status = String(formData.get("status")) as "ACTIVE" | "INACTIVE";
  await applyStatus({ userId, status });
  revalidatePath("/admin/users");
}
