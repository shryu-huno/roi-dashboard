import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { isAllAccess, isTeamAdmin } from "@/lib/auth/rbac";
import { getRlsContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { listClients, listArchivedClients } from "@/lib/data/clients";
import { effectiveClientStatus } from "@/lib/clients/status";
import { getIncludeVat } from "@/lib/vat";
import { NewClientForm } from "./NewClientForm";
import { ArchiveClientButton } from "./ArchiveClientButton";
import { RestoreClientButton } from "./RestoreClientButton";
import { DeleteClientButton } from "./DeleteClientButton";
import { VatToggle } from "./VatToggle";
import { EasywelToggle } from "./EasywelToggle";
import { ManualButton } from "./ManualButton";

export default async function SettingsClientsPage() {
  const user = await requireRole("PM");
  // 보관/복원/하드삭제·현대이지웰·매뉴얼 등 관리 UI는 관리자(최고관리자·팀 관리자)에게 노출.
  // 팀 관리자의 실제 조작은 RLS가 자기 팀 고객사로 범위를 제한한다.
  const isAdmin = user.role === "SUPER_ADMIN" || isTeamAdmin(user.role);
  const isPm = user.role === "PM";
  // 고객사 생성은 전체 접근(최고관리자·정산담당자)과 팀 관리자만.
  const canCreate = isAllAccess(user.role) || isTeamAdmin(user.role);
  const ctx = getRlsContext(user);
  const [clients, archived, includeVat, pms] = await Promise.all([
    listClients(ctx),
    isAdmin ? listArchivedClients(ctx) : Promise.resolve([]),
    getIncludeVat(),
    // 담당 PM 후보(생성 폼용): 전체 접근은 전원, 팀 관리자는 자기 팀 소속만(그 외 배정 시 RLS로 막힌다). PM은 생성하지 않는다.
    // 팀에 소속된 최고관리자도 후보에 포함한다(특정 팀의 PM 역할을 겸하는 예외 계정).
    canCreate
      ? prisma.user.findMany({
          where: {
            status: "ACTIVE",
            OR: [
              { role: { in: ["PM", "ADMIN"] } },
              { role: "SUPER_ADMIN", teamId: { not: null } },
            ],
            ...(isAllAccess(user.role) ? {} : { teamId: user.teamId ?? undefined }),
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const pmOptions = pms
    .map((p) => ({ id: p.id, label: p.name ?? p.email }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">고객사 설정</h1>
          <ManualButton kind="client-settings" isAdmin={isAdmin} />
        </div>
        <VatToggle defaultOn={includeVat} />
      </div>

      {/* 고객사 추가는 전체 접근(최고관리자·정산담당자)과 팀 관리자만. PM은 배정받은 고객사 조회·상세 설정만 한다. */}
      {canCreate && <NewClientForm pms={pmOptions} />}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th>
            <th>상태</th>
            <th>사업자 구분</th>
            <th>프로젝트</th>
            {isAdmin && <th>현대이지웰</th>}
            {isAdmin && <th>삭제</th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-white">
              <td className="py-2">{c.name}</td>
              <td>{effectiveClientStatus(c.status, c.projects)}</td>
              <td className="text-[var(--color-muted)]">{c.businessType ?? "—"}</td>
              <td>
                <Link href={`/settings/clients/${c.id}`} className="text-[var(--color-primary)]">상세 설정</Link>
              </td>
              {isAdmin && (
                <td>
                  <EasywelToggle id={c.id} defaultOn={c.hyundaiEasywel} />
                </td>
              )}
              {isAdmin && (
                <td>
                  <ArchiveClientButton id={c.id} name={c.name} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <section className="mt-10">
          <h2 className="mb-2 text-base font-semibold">숨김 처리된 고객사</h2>
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            삭제(숨김)된 고객사입니다. 목록·전사 집계에서 제외되며, 데이터는 보존됩니다. 복원하면 다시 표시됩니다. 삭제 시 연관 데이터까지 완전히 제거되며 되돌릴 수 없습니다.
          </p>
          {archived.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">보관된 고객사가 없습니다.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
                  <th className="py-2">고객사</th>
                  <th>상태</th>
                  <th>복원</th>
                  <th>삭제</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-white">
                    <td className="py-2">{c.name}</td>
                    <td>{c.status}</td>
                    <td>
                      <RestoreClientButton id={c.id} />
                    </td>
                    <td>
                      <DeleteClientButton id={c.id} name={c.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
