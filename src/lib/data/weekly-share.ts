import { withRLS, type RlsContext } from "@/lib/rls";
import { canWriteWeeklyShare } from "@/lib/auth/rbac";

// ---- 입력/결과 타입 ---------------------------------------------------------------

export type WeeklyEntryInput = {
  clientId: string;
  thisWeek: string;
  nextWeek: string;
  note: string;
  noSpecial: boolean; // "이번 주 특이사항 없음" — 내용 없이 작성 완료
  // 화면이 기록을 불러왔을 때의 version. 기록이 없었으면 null. 그 사이 다른 PM이 저장했으면 충돌로 처리한다.
  version: number | null;
};

export type OtherWorkInput = {
  tags: string[];
  thisWeek: string;
  nextWeek: string;
  note: string;
  supportClientId: string | null;
};

export type WeeklySubmitInput = {
  weekStart: string; // 그 주 일요일 "YYYY-MM-DD"
  entries: WeeklyEntryInput[];
  other: OtherWorkInput | null; // null = 이번 제출에서 기타 업무를 다루지 않음
};

export type WeeklyConflict = {
  clientId: string;
  updatedByName: string | null; // 먼저 저장한 PM
  updatedAt: Date;
};

export type WeeklySubmitResult = {
  ok: boolean; // 충돌·거부가 하나도 없을 때 true
  saved: string[]; // 새로 만들었거나 고친 고객사
  unchanged: string[]; // 내용이 같아 건드리지 않은 고객사(시각·수정 표시 유지)
  skipped: string[]; // 비어 있는 새 카드(저장하지 않음)
  conflicts: WeeklyConflict[]; // 그 사이 다른 PM이 저장해 저장하지 않은 카드
  rejected: { clientId: string; reason: "NOT_ASSIGNED" | "EMPTY_EXISTING" }[];
  other: "none" | "saved" | "unchanged" | "skipped" | "rejected";
};

// ---- 내부 유틸 --------------------------------------------------------------------

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

// 앞뒤 공백은 지우고 줄바꿈은 유지한다. "특이사항 없음"이면 내용을 모두 비운다.
function normalizeEntry(e: WeeklyEntryInput) {
  const clear = e.noSpecial;
  return {
    thisWeek: clear ? "" : e.thisWeek.trim(),
    nextWeek: clear ? "" : e.nextWeek.trim(),
    note: clear ? "" : e.note.trim(),
    noSpecial: e.noSpecial,
  };
}

const hasEntryContent = (n: ReturnType<typeof normalizeEntry>) => n.noSpecial || !!(n.thisWeek || n.nextWeek || n.note);

const sameText = (
  a: { thisWeek: string; nextWeek: string; note: string; noSpecial: boolean },
  b: { thisWeek: string; nextWeek: string; note: string; noSpecial: boolean },
) => a.thisWeek === b.thisWeek && a.nextWeek === b.nextWeek && a.note === b.note && a.noSpecial === b.noSpecial;

// ---- 제출 --------------------------------------------------------------------------

/**
 * 주간 공유 제출 한 번으로 고객사 카드들과 기타 업무를 저장한다(임시저장 없음).
 *  - 쓰기는 PM/파트장이면서 그 고객사의 담당 PM인 경우만. 관리자·비담당 PM은 거부(DB RLS도 막는다).
 *  - 담당 PM 전원이 같은 건을 고칠 수 있으므로 version으로 동시 수정을 감지한다.
 *    충돌한 카드만 저장하지 않고 알리며, 나머지 카드는 정상 저장한다.
 *  - 내용이 같으면 저장하지 않아 시각·수정자·수정 표시·version이 바뀌지 않는다.
 *  - 비어 있는 새 카드는 저장하지 않는다. 이미 있는 기록을 전부 비우는 제출은 막는다.
 */
export function submitWeekly(ctx: RlsContext, input: WeeklySubmitInput): Promise<WeeklySubmitResult> {
  return withRLS(ctx, async (tx) => {
    const weekStart = toDate(input.weekStart);
    const result: WeeklySubmitResult = {
      ok: true, saved: [], unchanged: [], skipped: [], conflicts: [], rejected: [], other: "none",
    };
    const writer = canWriteWeeklyShare(ctx.role);

    const assigned = new Set(
      writer && input.entries.length
        ? (
            await tx.clientManager.findMany({
              where: { userId: ctx.userId, clientId: { in: input.entries.map((e) => e.clientId) } },
              select: { clientId: true },
            })
          ).map((r) => r.clientId)
        : [],
    );

    const conflictOf = async (clientId: string) => {
      const cur = await tx.weeklyShare.findUnique({
        where: { weekStart_clientId: { weekStart, clientId } },
        include: { updatedBy: { select: { name: true, email: true } } },
      });
      result.conflicts.push({
        clientId,
        updatedByName: cur?.updatedBy ? cur.updatedBy.name ?? cur.updatedBy.email : null,
        updatedAt: cur?.updatedAt ?? new Date(),
      });
    };

    for (const e of input.entries) {
      if (!assigned.has(e.clientId)) {
        result.rejected.push({ clientId: e.clientId, reason: "NOT_ASSIGNED" });
        continue;
      }
      const next = normalizeEntry(e);
      const existing = await tx.weeklyShare.findUnique({
        where: { weekStart_clientId: { weekStart, clientId: e.clientId } },
      });

      if (!existing) {
        if (!hasEntryContent(next)) {
          result.skipped.push(e.clientId);
          continue;
        }
        // 동시에 다른 PM이 먼저 만들었으면(유니크 충돌) 삽입이 건너뛰어져 count=0 → 충돌.
        const { count } = await tx.weeklyShare.createMany({
          data: [{ weekStart, clientId: e.clientId, ...next, createdById: ctx.userId, updatedById: ctx.userId }],
          skipDuplicates: true,
        });
        if (count === 1) result.saved.push(e.clientId);
        else await conflictOf(e.clientId);
        continue;
      }

      if (!hasEntryContent(next)) {
        result.rejected.push({ clientId: e.clientId, reason: "EMPTY_EXISTING" });
        continue;
      }
      if (sameText(existing, next)) {
        result.unchanged.push(e.clientId);
        continue;
      }
      if (e.version !== existing.version) {
        await conflictOf(e.clientId);
        continue;
      }
      const { count } = await tx.weeklyShare.updateMany({
        where: { id: existing.id, version: existing.version },
        data: { ...next, updatedById: ctx.userId, editedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 1) result.saved.push(e.clientId);
      else await conflictOf(e.clientId);
    }

    if (input.other) result.other = await saveOtherWork(tx, ctx, weekStart, input.other, writer);

    result.ok = result.conflicts.length === 0 && result.rejected.length === 0 && result.other !== "rejected";
    return result;
  });
}

type Tx = Parameters<Parameters<typeof withRLS>[1]>[0];

async function saveOtherWork(
  tx: Tx,
  ctx: RlsContext,
  weekStart: Date,
  raw: OtherWorkInput,
  writer: boolean,
): Promise<WeeklySubmitResult["other"]> {
  if (!writer) return "rejected";
  const next = {
    tags: raw.tags,
    thisWeek: raw.thisWeek.trim(),
    nextWeek: raw.nextWeek.trim(),
    note: raw.note.trim(),
    supportClientId: raw.supportClientId,
  };
  const hasContent = !!(next.tags.length || next.thisWeek || next.nextWeek || next.note || next.supportClientId);
  const existing = await tx.weeklyOtherWork.findUnique({ where: { weekStart_authorId: { weekStart, authorId: ctx.userId } } });

  if (!existing) {
    if (!hasContent) return "skipped";
    await tx.weeklyOtherWork.create({ data: { weekStart, authorId: ctx.userId, ...next } });
    return "saved";
  }
  if (!hasContent) return "rejected";
  const same =
    existing.thisWeek === next.thisWeek && existing.nextWeek === next.nextWeek && existing.note === next.note &&
    existing.supportClientId === next.supportClientId && existing.tags.join("\u0000") === next.tags.join("\u0000");
  if (same) return "unchanged";
  await tx.weeklyOtherWork.update({ where: { id: existing.id }, data: { ...next, editedAt: new Date() } });
  return "saved";
}
