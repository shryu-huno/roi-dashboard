import type { Prisma } from "@prisma/client";
import { withRLS, type RlsContext } from "@/lib/rls";
import { canWriteWeeklyShare } from "@/lib/auth/rbac";
import type { HistoryOther, HistoryShare } from "@/lib/weekly-history";

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
};

export type WeeklySubmitInput = {
  weekStart: string; // 그 주 일요일 "YYYY-MM-DD"
  entries: WeeklyEntryInput[];
  other: OtherWorkInput | null; // null = 이번 제출에서 기타 업무를 다루지 않음
};

// 화면에 보여 주는 저장 상태(날짜는 ISO 문자열 — 화면에서 formatKstDateTime으로 표기).
export type WeeklyShareView = {
  version: number;
  thisWeek: string;
  nextWeek: string;
  note: string;
  noSpecial: boolean;
  createdByName: string | null; // 최초 제출자
  updatedByName: string | null; // 마지막 저장자
  createdAt: string;
  updatedAt: string;
  editedAt: string | null; // 최초 제출 후 내용이 바뀐 저장이 있을 때만(= "수정됨")
};

export type OtherWorkView = {
  tags: string[];
  thisWeek: string;
  nextWeek: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
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
  // 제출 후 각 카드의 최신 저장 상태(충돌한 카드는 다른 PM이 저장한 내용). 화면이 새로고침 없이 상태를 맞추는 데 쓴다.
  current: Record<string, WeeklyShareView | null>;
  otherCurrent: OtherWorkView | null;
};

// ---- 내부 유틸 --------------------------------------------------------------------

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

const nameSelect = { select: { name: true, email: true } } as const;
type ShareRow = Prisma.WeeklyShareGetPayload<{ include: { createdBy: typeof nameSelect; updatedBy: typeof nameSelect } }>;
const shareInclude = { createdBy: nameSelect, updatedBy: nameSelect } as const;
const displayName = (u: { name: string | null; email: string } | null) => (u ? u.name ?? u.email : null);

function toShareView(r: ShareRow): WeeklyShareView {
  return {
    version: r.version,
    thisWeek: r.thisWeek,
    nextWeek: r.nextWeek,
    note: r.note,
    noSpecial: r.noSpecial,
    createdByName: displayName(r.createdBy),
    updatedByName: displayName(r.updatedBy),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    editedAt: r.editedAt ? r.editedAt.toISOString() : null,
  };
}

function toOtherView(r: Prisma.WeeklyOtherWorkGetPayload<object>): OtherWorkView {
  return {
    tags: r.tags,
    thisWeek: r.thisWeek,
    nextWeek: r.nextWeek,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    editedAt: r.editedAt ? r.editedAt.toISOString() : null,
  };
}

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
      current: {}, otherCurrent: null,
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

    // 최신 상태 반환: 담당 카드는 저장 후 현재 값(충돌 카드는 다른 PM이 저장한 값), 기타 업무는 내 기록.
    const assignedIds = input.entries.map((e) => e.clientId).filter((id) => assigned.has(id));
    if (assignedIds.length) {
      const rows = await tx.weeklyShare.findMany({
        where: { weekStart, clientId: { in: assignedIds } },
        include: shareInclude,
      });
      const byClient = new Map(rows.map((r) => [r.clientId, r]));
      for (const id of assignedIds) {
        const row = byClient.get(id);
        result.current[id] = row ? toShareView(row) : null;
      }
    }
    if (input.other && writer) {
      const mine = await tx.weeklyOtherWork.findUnique({ where: { weekStart_authorId: { weekStart, authorId: ctx.userId } } });
      result.otherCurrent = mine ? toOtherView(mine) : null;
    }

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
  };
  const hasContent = !!(next.tags.length || next.thisWeek || next.nextWeek || next.note);
  const existing = await tx.weeklyOtherWork.findUnique({ where: { weekStart_authorId: { weekStart, authorId: ctx.userId } } });

  if (!existing) {
    if (!hasContent) return "skipped";
    await tx.weeklyOtherWork.create({ data: { weekStart, authorId: ctx.userId, ...next } });
    return "saved";
  }
  if (!hasContent) return "rejected";
  const same =
    existing.thisWeek === next.thisWeek && existing.nextWeek === next.nextWeek && existing.note === next.note &&
    existing.tags.join("\u0000") === next.tags.join("\u0000");
  if (same) return "unchanged";
  await tx.weeklyOtherWork.update({ where: { id: existing.id }, data: { ...next, editedAt: new Date() } });
  return "saved";
}

// ---- 주간 공유 화면용 조회 ---------------------------------------------------------------------

export type WeeklyBatchClient = {
  id: string;
  name: string;
  share: WeeklyShareView | null; // 이번 주 기록(없으면 미작성)
  prevNextWeek: string; // 지난주 기록의 "다음주" 내용 — "지난주 계획 가져오기"용
};

export type WeeklyBatchData = {
  clients: WeeklyBatchClient[];
  other: OtherWorkView | null;
  weekStatus: Record<string, number>; // 주(일요일) → 기록이 있는 고객사 수(주차 칩의 진행 점)
};

/**
 * 한 PM의 담당 고객사 전체와 그 주의 기록을 한 번에 읽는다. 조회 범위는 RLS가 정한다
 * (PM은 본인 담당만, 관리자는 자기 범위 안에서 다른 PM의 것을 읽기 전용으로 본다).
 */
export function loadWeeklyBatch(
  ctx: RlsContext,
  p: { pmId: string; weekStart: string; prevWeekStart: string; weeks: string[] },
): Promise<WeeklyBatchData> {
  return withRLS(ctx, async (tx) => {
    const assignments = await tx.clientManager.findMany({
      where: { userId: p.pmId, client: { deletedAt: null } },
      select: { client: { select: { id: true, name: true } } },
    });
    const clients = assignments.map((a) => a.client).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const ids = clients.map((c) => c.id);
    const weekStart = toDate(p.weekStart);
    const prevWeekStart = toDate(p.prevWeekStart);

    const [shares, grouped, other] = await Promise.all([
      tx.weeklyShare.findMany({
        where: { clientId: { in: ids }, weekStart: { in: [weekStart, prevWeekStart] } },
        include: shareInclude,
      }),
      tx.weeklyShare.groupBy({
        by: ["weekStart"],
        where: { clientId: { in: ids }, weekStart: { in: p.weeks.map(toDate) } },
        _count: { _all: true },
      }),
      tx.weeklyOtherWork.findUnique({ where: { weekStart_authorId: { weekStart, authorId: p.pmId } } }),
    ]);
    return {
      clients: clients.map((c) => {
        const mine = shares.filter((r) => r.clientId === c.id);
        const cur = mine.find((r) => ymdOf(r.weekStart) === p.weekStart);
        const prev = mine.find((r) => ymdOf(r.weekStart) === p.prevWeekStart);
        return {
          id: c.id,
          name: c.name,
          share: cur ? toShareView(cur) : null,
          prevNextWeek: prev?.nextWeek ?? "",
        };
      }),
      other: other ? toOtherView(other) : null,
      weekStatus: Object.fromEntries(grouped.map((g) => [ymdOf(g.weekStart), g._count._all])),
    };
  });
}

/** 가장 이른 주간 공유 주(일요일). 월 선택 범위의 아래쪽 한계를 정하는 데 쓴다. 기록이 없으면 null. */
export function earliestWeekStart(ctx: RlsContext): Promise<string | null> {
  return withRLS(ctx, async (tx) => {
    const [a, b] = await Promise.all([
      tx.weeklyShare.aggregate({ _min: { weekStart: true } }),
      tx.weeklyOtherWork.aggregate({ _min: { weekStart: true } }),
    ]);
    const dates = [a._min.weekStart, b._min.weekStart].filter((d): d is Date => !!d).map(ymdOf).sort();
    return dates[0] ?? null;
  });
}

// ---- 히스토리용 조회 -----------------------------------------------------------------------------

export type WeeklyHistoryData = {
  pms: { id: string; name: string; partName: string | null }[]; // 파트 순서 → 이름순
  clientsByPm: Record<string, { id: string; name: string }[]>; // 공동 담당 고객사는 담당 PM 모두에게 들어간다
  shares: HistoryShare[];
  others: HistoryOther[];
};

/**
 * 선택한 PM들의 담당 고객사와, 조회한 주(일요일 키)의 주간 공유·기타 업무 기록을 한 번에 읽는다.
 * 조회 범위는 RLS가 정한다(PM은 본인 담당, 팀 관리자는 자기 팀, 최고관리자는 전체).
 * 행 구성·정렬·검색은 순수 함수(lib/weekly-history.ts)가 맡는다.
 */
export function loadWeeklyHistory(ctx: RlsContext, p: { pmIds: string[]; weeks: string[] }): Promise<WeeklyHistoryData> {
  return withRLS(ctx, async (tx) => {
    const users = await tx.user.findMany({
      where: { id: { in: p.pmIds } },
      select: { id: true, name: true, email: true, part: { select: { name: true, sortOrder: true } } },
    });
    const pms = users
      .map((u) => ({ id: u.id, name: u.name ?? u.email, partName: u.part?.name ?? null, partSort: u.part?.sortOrder ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.partSort - b.partSort || a.name.localeCompare(b.name, "ko"))
      .map(({ id, name, partName }) => ({ id, name, partName }));

    const assignments = await tx.clientManager.findMany({
      where: { userId: { in: p.pmIds }, client: { deletedAt: null } },
      select: { userId: true, client: { select: { id: true, name: true } } },
    });
    const clientsByPm: WeeklyHistoryData["clientsByPm"] = {};
    for (const a of assignments) (clientsByPm[a.userId] ??= []).push(a.client);
    const clientIds = [...new Set(assignments.map((a) => a.client.id))];

    const weekDates = p.weeks.map(toDate);
    const [shares, others] = await Promise.all([
      tx.weeklyShare.findMany({ where: { clientId: { in: clientIds }, weekStart: { in: weekDates } }, include: shareInclude }),
      tx.weeklyOtherWork.findMany({ where: { authorId: { in: p.pmIds }, weekStart: { in: weekDates } } }),
    ]);
    return {
      pms,
      clientsByPm,
      shares: shares.map((r) => ({ ...toShareView(r), clientId: r.clientId, weekStart: ymdOf(r.weekStart) })),
      others: others.map((r) => ({ ...toOtherView(r), authorId: r.authorId, weekStart: ymdOf(r.weekStart) })),
    };
  });
}
