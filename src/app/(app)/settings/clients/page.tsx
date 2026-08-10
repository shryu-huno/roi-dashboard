import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients, listArchivedClients } from "@/lib/data/clients";
import { getIncludeVat } from "@/lib/vat";
import { NewClientForm } from "./NewClientForm";
import { ArchiveClientButton } from "./ArchiveClientButton";
import { RestoreClientButton } from "./RestoreClientButton";
import { DeleteClientButton } from "./DeleteClientButton";
import { VatToggle } from "./VatToggle";
import { EasywelToggle } from "./EasywelToggle";

export default async function SettingsClientsPage() {
  const user = await requireRole("PM");
  const isAdmin = user.role === "ADMIN";
  const isPm = user.role === "PM";
  const ctx = getRlsContext(user);
  const [clients, archived, includeVat] = await Promise.all([
    listClients(ctx),
    isAdmin ? listArchivedClients(ctx) : Promise.resolve([]),
    getIncludeVat(),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">고객사 설정</h1>
        <VatToggle defaultOn={includeVat} />
      </div>

      {/* 고객사 추가는 정산담당자/관리자만. PM은 배정받은 고객사 조회·상세 설정만 한다. */}
      {!isPm && <NewClientForm />}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">고객사</th>
            <th>상태</th>
            <th>사업자 구분</th>
            <th>프로젝트</th>
            <th>현대이지웰</th>
            {isAdmin && <th>삭제</th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-white">
              <td className="py-2">{c.name}</td>
              <td>{c.status}</td>
              <td className="text-[var(--color-muted)]">{c.businessType ?? "—"}</td>
              <td>
                <Link href={`/settings/clients/${c.id}`} className="text-[var(--color-primary)]">상세 설정</Link>
              </td>
              <td>
                <EasywelToggle id={c.id} defaultOn={c.hyundaiEasywel} />
              </td>
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
