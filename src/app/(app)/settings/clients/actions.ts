"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/auth/session";
import { isAllAccess, isTeamAdmin } from "@/lib/auth/rbac";
import { getRlsContext } from "@/lib/context";
import { VAT_COOKIE } from "@/lib/vat";
import { clientSchema, projectSchema, taskSchema } from "@/lib/validation/schemas";
import { deriveProjectName } from "@/lib/clients/summary-view";
import { createClient, updateClient, archiveClient, restoreClient, hardDeleteClient, setClientEasywel } from "@/lib/data/clients";
import { createProject, updateProject, deleteProject } from "@/lib/data/projects";
import { createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { type ActionState, SAVED } from "@/lib/action-state";

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // 고객사 생성은 전체 접근(최고관리자·정산담당자)과 팀 관리자만. 팀 관리자는 자기 팀 소속 PM만
  // 배정할 수 있고(ClientManager RLS가 강제), Client INSERT는 team_admin_create_client 마이그레이션이 허용한다.
  const user = await requireRole("PM");
  if (!isAllAccess(user.role) && !isTeamAdmin(user.role)) {
    return { ok: false, error: "고객사를 추가할 권한이 없습니다." };
  }
  const ctx = getRlsContext(user);
  // 담당 PM은 여기서 배정. 주기·계약기간은 고객사 생성 후 프로젝트에서 지정.
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    businessType: formData.get("businessType"),
    industry: formData.get("industry"),
    pmIds: formData.getAll("pmIds"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 고객사명을 확인하세요." };
  // 고객사명·사업자 구분·담당 PM은 필수(배정된 PM이 프로젝트·과업을 설정한다).
  if (!parsed.data.businessType) return { ok: false, error: "사업자 구분을 선택해주세요." };
  if (!parsed.data.pmIds?.length) return { ok: false, error: "담당 PM을 최소 1명 이상 지정해주세요." };
  await createClient(ctx, parsed.data);
  revalidatePath("/settings/clients");
  return SAVED;
}

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // PM도 본인 담당 고객사 정보를 수정할 수 있다(RLS가 담당 고객사로 범위 제한).
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") ?? undefined,
    businessType: formData.get("businessType"),
    industry: formData.get("industry"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };
  const result = await updateClient(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${id}`);
  return result.ok ? SAVED : result;
}

// 프로젝트명은 항상 계약 기간 연도로 자동 생성한다(입력란 없음). 계약 기간이 없으면 "미정".
function projectNameFrom(formData: FormData): string {
  const start = String(formData.get("contractStart") ?? "");
  const end = String(formData.get("contractEnd") ?? "");
  return deriveProjectName(start, end) || "미정";
}

// 프로젝트 추가 — PM 이상. 담당 PM 배정은 정산/관리자만(PM 생성 시 배정 없이 생성, 접근은 고객사 담당으로 유지).
export async function createProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const clientId = String(formData.get("clientId"));
  const canAssignPms = isAllAccess(user.role) || isTeamAdmin(user.role);
  const parsed = projectSchema.safeParse({
    clientId,
    name: projectNameFrom(formData),
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    billingCycle: formData.getAll("billingCycle"),
    reportCycle: formData.getAll("reportCycle"),
    performanceContract: formData.get("performanceContract"),
    pmIds: canAssignPms ? formData.getAll("pmIds") : [],
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };
  await createProject(ctx, clientId, parsed.data);
  revalidatePath(`/settings/clients/${clientId}`);
  return SAVED;
}

// 프로젝트 수정 — PM도 본인 담당 프로젝트를 수정할 수 있다(RLS로 범위 제한).
// 기본정보와 담당 PM을 한 번에 저장한다. 담당 PM 배정은 정산/관리자만(그 외에는 pmIds 미포함→PM 유지).
export async function updateProjectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const id = String(formData.get("id"));
  const clientId = String(formData.get("clientId"));
  const canAssignPms = isAllAccess(user.role) || isTeamAdmin(user.role);
  const parsed = projectSchema.safeParse({
    clientId,
    name: projectNameFrom(formData), // 계약 기간 연도로 재생성(입력란 없음).
    status: formData.get("status") ?? undefined,
    contractStart: formData.get("contractStart"),
    contractEnd: formData.get("contractEnd"),
    billingCycle: formData.getAll("billingCycle"),
    reportCycle: formData.getAll("reportCycle"),
    performanceContract: formData.get("performanceContract"),
    // 권한자만 담당 PM 교체(undefined면 updateProject가 PM 배정을 건드리지 않는다).
    pmIds: canAssignPms ? formData.getAll("pmIds") : undefined,
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다." };
  const result = await updateProject(ctx, id, parsed.data);
  revalidatePath(`/settings/clients/${clientId}`);
  return result.ok ? SAVED : result;
}

// 프로젝트 삭제 — PM 이상(자기 담당 고객사 한정, RLS로 강제). 과업·실적 등 연관 데이터가 cascade 삭제된다(되돌릴 수 없음).
export async function deleteProjectAction(formData: FormData): Promise<void> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const clientId = String(formData.get("clientId"));
  await deleteProject(ctx, String(formData.get("id")));
  revalidatePath(`/settings/clients/${clientId}`);
}

// 현대이지웰 여부 토글 — 목록 인라인 체크박스. PM도 본인 담당 고객사는 토글 가능(RLS로 범위 제한).
export async function setClientEasywelAction(id: string, on: boolean): Promise<void> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  await setClientEasywel(ctx, id, on);
  revalidatePath("/settings/clients");
}

// 고객사 소프트 삭제(보관) — 최고관리자(SUPER_ADMIN) 전용. UI 버튼 노출과 별개로 서버에서 강제한다.
export async function archiveClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  await archiveClient(ctx, String(formData.get("id")));
  revalidatePath("/settings/clients");
}

// 보관 취소(복원) — 최고관리자(SUPER_ADMIN) 전용.
export async function restoreClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  await restoreClient(ctx, String(formData.get("id")));
  revalidatePath("/settings/clients");
}

// 하드 삭제 — 최고관리자(SUPER_ADMIN) 전용. 숨김 처리된 고객사만 완전 삭제(연관 데이터 포함, 되돌릴 수 없음).
export async function hardDeleteClientAction(formData: FormData): Promise<void> {
  const user = await requireRole("SUPER_ADMIN");
  const ctx = getRlsContext(user);
  await hardDeleteClient(ctx, String(formData.get("id")));
  revalidatePath("/settings/clients");
}

export async function createTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);
  const parsed = taskSchema.safeParse({
    clientId: formData.get("clientId"),
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractCount: formData.get("contractCount"),
    contractAmount: formData.get("contractAmount"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 단가는 정수여야 합니다(음수 가능)." };
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
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    unitPrice: formData.get("unitPrice"),
    contractCount: formData.get("contractCount"),
    contractAmount: formData.get("contractAmount"),
  });
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다. 단가는 정수여야 합니다(음수 가능)." };
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

// 부가세 포함 표시 여부(전체 대시보드·리포트에 적용). 쿠키로 저장, 기본 On.
export async function setIncludeVatAction(on: boolean): Promise<void> {
  await requireUser();
  const store = await cookies();
  if (on) {
    store.delete(VAT_COOKIE); // 기본값이 On이므로 쿠키 삭제 = 포함
  } else {
    store.set(VAT_COOKIE, "0", { path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
}
