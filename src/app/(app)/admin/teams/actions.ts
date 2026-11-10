"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { withRLS } from "@/lib/rls";
import { createPart, renamePart, deletePart, deleteTeam } from "@/lib/data/parts";

// 팀 쓰기(생성/수정/삭제)는 최고관리자 전용. Team RLS(team_write_admin)가 앱 컨텍스트의
// app.user_role IN (SUPER_ADMIN, SETTLEMENT)을 요구하므로 반드시 withRLS로 컨텍스트를 주입한다.
export async function createTeamAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await withRLS(ctx, (tx) => tx.team.create({ data: { name } }));
  revalidatePath("/admin/teams");
}

export async function renameTeamAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await withRLS(ctx, (tx) => tx.team.update({ where: { id }, data: { name } }));
  revalidatePath("/admin/teams");
}

// 팀 삭제 시 소속 사용자의 teamId는 FK(ON DELETE SET NULL)로 자동 해제되고, 팀의 파트는 함께 삭제된다
// (파트 소속 PM의 소속 파트장 해제는 deleteTeam이 처리).
export async function deleteTeamAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const result = await deleteTeam(ctx, String(formData.get("id")));
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin/teams");
}

// 파트 쓰기도 최고관리자 전용(Part RLS part_write_admin). 실패(중복 이름 등)는 오류 화면으로 알린다.
export async function createPartAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const result = await createPart(ctx, String(formData.get("teamId")), String(formData.get("name") ?? ""));
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin/teams");
}

export async function renamePartAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const result = await renamePart(ctx, String(formData.get("id")), String(formData.get("name") ?? ""));
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin/teams");
}

// 파트 삭제 시 소속 인원의 파트는 해제되고(팀은 유지) PM의 소속 파트장도 함께 해제된다.
export async function deletePartAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const result = await deletePart(ctx, String(formData.get("id")));
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/admin/teams");
}
