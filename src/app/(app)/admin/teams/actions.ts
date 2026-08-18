"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { withRLS } from "@/lib/rls";

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

// 팀 삭제 시 소속 사용자의 teamId는 FK(ON DELETE SET NULL)로 자동 해제된다.
export async function deleteTeamAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  await withRLS(ctx, (tx) => tx.team.delete({ where: { id } }));
  revalidatePath("/admin/teams");
}
