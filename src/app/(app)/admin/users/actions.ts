"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/auth/rbac";

/** DB 반영 코어 (테스트 대상, 세션 비의존). */
export async function applyApproval(input: {
  userId: string;
  role: AppRole;
  teamId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.user.updateMany({
    where: { id: input.userId },
    data: { status: "ACTIVE", role: input.role, teamId: input.teamId ?? null },
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

export async function applyHardDelete(input: {
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  // 비활성(INACTIVE) 계정만 완전 삭제한다. 활성/대기 계정은 쿼리 레벨에서 차단.
  // 담당 배정·OAuth 계정·세션은 FK Cascade로, 지급요청은 FK SET NULL으로 자동 정리된다.
  const result = await prisma.user.deleteMany({
    where: { id: input.userId, status: "INACTIVE" },
  });
  if (result.count === 0) return { ok: false, error: "비활성 사용자를 찾을 수 없습니다." };
  return { ok: true };
}

/** 폼에서 호출하는 server action (최고관리자 전용). */
export async function approveUser(formData: FormData): Promise<void> {
  await requireRole("SUPER_ADMIN");
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as AppRole;
  // 팀 미지정("")은 null로 저장. 최고관리자·정산담당자는 팀이 무의미하지만 저장돼도 무해하다.
  const teamId = String(formData.get("teamId") ?? "") || null;
  await applyApproval({ userId, role, teamId });
  revalidatePath("/admin/users");
}

export async function changeStatus(formData: FormData): Promise<void> {
  await requireRole("SUPER_ADMIN");
  const userId = String(formData.get("userId"));
  const status = String(formData.get("status")) as "ACTIVE" | "INACTIVE";
  await applyStatus({ userId, status });
  revalidatePath("/admin/users");
}

export async function hardDeleteUser(formData: FormData): Promise<void> {
  await requireRole("SUPER_ADMIN");
  const userId = String(formData.get("userId"));
  await applyHardDelete({ userId });
  revalidatePath("/admin/users");
}
