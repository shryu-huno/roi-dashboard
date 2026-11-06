"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/auth/rbac";
import { syncPartLeaders } from "@/lib/data/parts";

/**
 * DB 반영 코어 (테스트 대상, 세션 비의존).
 * 파트는 PM·파트장에게만 의미가 있고 반드시 선택한 팀의 파트여야 한다. 한 파트의 파트장은 1명.
 * 사람은 partId로 배분하고, PM의 partLeaderId(파트장 권한 RLS 기준)는 syncPartLeaders가 맞춘다.
 */
export async function applyApproval(input: {
  userId: string;
  role: AppRole;
  teamId?: string | null;
  partId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const current = await prisma.user.findUnique({ where: { id: input.userId }, select: { partId: true } });
  if (!current) return { ok: false, error: "사용자를 찾을 수 없습니다." };

  const teamId = input.teamId ?? null;
  const partId = input.role === "PM" || input.role === "PART_LEADER" ? input.partId ?? null : null;

  if (partId) {
    const part = await prisma.part.findUnique({ where: { id: partId }, select: { teamId: true } });
    if (!part || part.teamId !== teamId) return { ok: false, error: "선택한 팀에 속한 파트가 아닙니다." };
    if (input.role === "PART_LEADER") {
      const other = await prisma.user.findFirst({
        where: { partId, role: "PART_LEADER", status: "ACTIVE", id: { not: input.userId } },
        select: { id: true },
      });
      if (other) return { ok: false, error: "이 파트에는 이미 파트장이 있습니다." };
    }
  }

  // partLeaderId: PM+파트면 아래 sync가 채운다. 파트와 무관해지는 경우(PM 외 역할, 파트에서 빠짐)만 비운다.
  // 파트 배정 전의 기존 PM(partId·새 partId 모두 없음)은 기존 partLeaderId를 유지해 권한을 잃지 않게 한다.
  const clearLeader = input.role !== "PM" || (!partId && current.partId !== null);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { status: "ACTIVE", role: input.role, teamId, partId, ...(clearLeader ? { partLeaderId: null } : {}) },
    });
    await syncPartLeaders(tx, [current.partId, partId]);
  });
  return { ok: true };
}

export async function applyStatus(input: {
  userId: string;
  status: "ACTIVE" | "INACTIVE";
}): Promise<{ ok: boolean; error?: string }> {
  const current = await prisma.user.findUnique({ where: { id: input.userId }, select: { partId: true } });
  if (!current) return { ok: false, error: "사용자를 찾을 수 없습니다." };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { status: input.status } });
    // 파트장이 활성/비활성이 되면 그 파트 PM의 소속 파트장도 따라가야 한다.
    await syncPartLeaders(tx, [current.partId]);
  });
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
  // 파트 미지정("")은 null. PM·파트장만 저장되고, 선택한 팀의 파트인지는 applyApproval이 검증한다.
  const partId = String(formData.get("partId") ?? "") || null;
  const result = await applyApproval({ userId, role, teamId, partId });
  // form action은 반환값을 쓰지 않으므로 검증 실패는 오류 화면(error.tsx)으로 알린다.
  if (!result.ok) throw new Error(result.error);
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
