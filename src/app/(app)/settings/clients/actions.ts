"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { clientSchema, taskSchema } from "@/lib/validation/schemas";
import { createClient, updateClient } from "@/lib/data/clients";
import { createTask, updateTask, deleteTask } from "@/lib/data/tasks";

export async function createClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    pmId: formData.get("pmId"),
  });
  if (parsed.success) await createClient(ctx, parsed.data);
  revalidatePath("/settings/clients");
}

export async function updateClientAction(formData: FormData): Promise<void> {
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
  if (parsed.success) await updateClient(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${id}`);
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractAmount: formData.get("contractAmount"),
  });
  if (parsed.success) await createTask(ctx, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractAmount: formData.get("contractAmount"),
  });
  if (parsed.success) await updateTask(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  await deleteTask(ctx, id);
  revalidatePath(`/settings/clients/${String(formData.get("clientId"))}`);
}
