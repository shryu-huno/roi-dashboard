"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { clientSchema, taskSchema } from "@/lib/validation/schemas";
import { createClient, updateClient } from "@/lib/data/clients";
import { createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 고객사명을 확인하세요." };
  await createClient(ctx, parsed.data);
  revalidatePath("/settings/clients");
  return SAVED;
}

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };
  const result = await updateClient(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${id}`);
  return result.ok ? SAVED : result;
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
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
  const user = await requireRole("SETTLEMENT");
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
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const result = await deleteTask(ctx, id);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
  return result.ok ? { ok: true, message: "삭제되었습니다." } : result;
}
