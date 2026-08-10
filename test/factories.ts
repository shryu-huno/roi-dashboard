import { createClient } from "@/lib/data/clients";
import { createProject, updateProjectPms } from "@/lib/data/projects";
import { createTask } from "@/lib/data/tasks";
import { withRLS, type RlsContext } from "@/lib/rls";

// 프로젝트 계층 도입 후 테스트 헬퍼. 예전 createClient({ pmIds })를 대체한다.
// 고객사 + 기본 프로젝트(담당 PM 포함)를 만들고 Client 레코드를 반환한다(.id 사용).
// 담당 PM은 프로젝트에 배정되고 앱과 동일하게 ClientManager로 동기화되어 RLS가 유지된다.
export async function mkClient(
  ctx: RlsContext,
  opts: { name: string; pmIds?: string[]; industry?: string | null; contractStart?: Date | null; contractEnd?: Date | null },
) {
  const client = await createClient(ctx, { name: opts.name, industry: opts.industry ?? undefined });
  await createProject(ctx, client.id, {
    name: "기본 프로젝트",
    pmIds: opts.pmIds ?? [],
    contractStart: opts.contractStart ?? null,
    contractEnd: opts.contractEnd ?? null,
  });
  return client;
}

// 고객사의 기본 프로젝트 id.
export async function projectIdOf(ctx: RlsContext, clientId: string): Promise<string> {
  const p = await withRLS(ctx, (tx) =>
    tx.project.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  );
  if (!p) throw new Error(`no project for client ${clientId}`);
  return p.id;
}

// clientId만으로 그 고객사의 기본 프로젝트에 과업 생성(projectId 자동 결합).
export async function mkTask(
  ctx: RlsContext,
  input: { clientId: string; name: string; unitPrice: number; contractCount?: number | null; contractAmount?: number | null },
) {
  const { clientId, ...rest } = input;
  const projectId = await projectIdOf(ctx, clientId);
  return createTask(ctx, { clientId, projectId, ...rest });
}

// 고객사 담당 PM 재설정(기본 프로젝트의 PM 교체 → ClientManager 동기화).
export async function setClientPms(ctx: RlsContext, clientId: string, pmIds: string[]) {
  return updateProjectPms(ctx, await projectIdOf(ctx, clientId), pmIds);
}
