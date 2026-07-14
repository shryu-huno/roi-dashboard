"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { clientSchema, taskSchema } from "@/lib/validation/schemas";
import { createClient, updateClient, updateClientPms, archiveClient, restoreClient } from "@/lib/data/clients";
import { createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    businessType: formData.get("businessType"),
    industry: formData.get("industry"),
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    billingCycle: formData.getAll("billingCycle"),
    reportCycle: formData.getAll("reportCycle"),
    pmIds: formData.getAll("pmIds"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 고객사명을 확인하세요." };
  if (!parsed.data.pmIds || parsed.data.pmIds.length === 0) {
    return { ok: false, error: "담당 PM을 최소 1명 이상 선택하세요." };
  }
  await createClient(ctx, parsed.data);
  revalidatePath("/settings/clients");
  return SAVED;
}

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // PM도 본인 담당 고객사 정보를 수정할 수 있다(RLS가 담당 고객사로 범위 제한).
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  // 담당 PM은 별도 폼(updateClientPmsAction)에서 관리한다. 여기서 pmIds를 넘기면
  // 빈 폼이 배정을 전부 지워버리므로, 이 액션은 PM 배정을 건드리지 않는다.
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    businessType: formData.get("businessType"),
    industry: formData.get("industry"),
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    billingCycle: formData.getAll("billingCycle"),
    reportCycle: formData.getAll("reportCycle"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };
  const result = await updateClient(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${id}`);
  return result.ok ? SAVED : result;
}

export async function updateClientPmsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const pmIds = formData.getAll("pmIds").map(String).filter((x) => x !== "");
  const result = await updateClientPms(ctx, id, pmIds);
  revalidatePath(`/settings/clients/${id}`);
  return result.ok ? SAVED : result;
}

// 고객사 소프트 삭제(보관) — 관리자(ADMIN) 전용. UI 버튼 노출과 별개로 서버에서 강제한다.
export async function archiveClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("ADMIN");
  const ctx = getRlsContext(user);
  await archiveClient(ctx, String(formData.get("id")));
  revalidatePath("/settings/clients");
}

// 보관 취소(복원) — 관리자(ADMIN) 전용.
export async function restoreClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("ADMIN");
  const ctx = getRlsContext(user);
  await restoreClient(ctx, String(formData.get("id")));
  revalidatePath("/settings/clients");
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractCount: formData.get("contractCount"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 단가는 0 이상의 정수여야 합니다." };
  await createTask(ctx, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
  return SAVED;
}

export async function updateTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractCount: formData.get("contractCount"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 단가는 0 이상의 정수여야 합니다." };
  const result = await updateTask(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
  return result.ok ? SAVED : result;
}

export async function deleteTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const result = await deleteTask(ctx, id);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
  return result.ok ? { ok: true, message: "삭제되었습니다." } : result;
}
