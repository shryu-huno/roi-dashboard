import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { submitWeekly, loadWeeklyBatch, loadWeeklyHistory, type WeeklyEntryInput } from "@/lib/data/weekly-share";
import { mkClient } from "./factories";

const ROOT: RlsContext = { userId: "seed-admin", role: "SUPER_ADMIN" };
const WEEK = "2026-11-01"; // 일요일
const WEEK2 = "2026-11-08";

let pmA: string, pmB: string, pmC: string, leaderL: string, adminT1: string, adminT2: string, superId: string;
let teamT1: string, teamT2: string;
let c1: string, c2: string, c3: string;
let ctxA: RlsContext, ctxB: RlsContext, ctxC: RlsContext, ctxSuper: RlsContext, ctxAdminT1: RlsContext, ctxAdminT2: RlsContext, ctxLeader: RlsContext;

const entry = (clientId: string, over: Partial<WeeklyEntryInput> = {}): WeeklyEntryInput => ({
  clientId, thisWeek: "이번주 내용", nextWeek: "다음주 계획", note: "", noSpecial: false, version: null, ...over,
});
// 기록은 (주, 고객사, 작성자)당 1건이다. authorId를 생략하면 그 고객사·주에 기록이 하나뿐이라고 보고 그 행을 돌려준다.
const rowOf = (clientId: string, weekStart = WEEK, authorId?: string) =>
  withRLS(ROOT, (tx) =>
    tx.weeklyShare.findFirst({ where: { weekStart: new Date(weekStart), clientId, ...(authorId ? { createdById: authorId } : {}) } }),
  );

beforeEach(async () => {
  await withRLS(ROOT, async (tx) => {
    // 주간 공유 테이블은 DELETE 정책이 없어(삭제 불가) 일반 delete로는 비워지지 않는다 → 테스트 초기화만 TRUNCATE.
    await tx.$executeRawUnsafe('TRUNCATE TABLE "WeeklyShare", "WeeklyOtherWork"');
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
    await tx.team.deleteMany();
  });
  await prisma.user.deleteMany();
  teamT1 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T1" } }))).id;
  teamT2 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T2" } }))).id;
  const mk = (email: string, role: "PM" | "ADMIN" | "PART_LEADER" | "SUPER_ADMIN", extra: object = {}) =>
    prisma.user.create({ data: { email, name: email.split("@")[0], role, status: "ACTIVE", ...extra } }).then((u) => u.id);
  leaderL = await mk("leader@huno.kr", "PART_LEADER", { teamId: teamT1 });
  pmA = await mk("pma@huno.kr", "PM", { teamId: teamT1, partLeaderId: leaderL });
  pmB = await mk("pmb@huno.kr", "PM", { teamId: teamT1 });
  pmC = await mk("pmc@huno.kr", "PM", { teamId: teamT2 });
  adminT1 = await mk("admt1@huno.kr", "ADMIN", { teamId: teamT1 });
  adminT2 = await mk("admt2@huno.kr", "ADMIN", { teamId: teamT2 });
  superId = await mk("super@huno.kr", "SUPER_ADMIN");
  ctxA = { userId: pmA, role: "PM", teamId: teamT1 };
  ctxB = { userId: pmB, role: "PM", teamId: teamT1 };
  ctxC = { userId: pmC, role: "PM", teamId: teamT2 };
  ctxSuper = { userId: superId, role: "SUPER_ADMIN" };
  ctxAdminT1 = { userId: adminT1, role: "ADMIN", teamId: teamT1 };
  ctxAdminT2 = { userId: adminT2, role: "ADMIN", teamId: teamT2 };
  ctxLeader = { userId: leaderL, role: "PART_LEADER", teamId: teamT1 };
  // C1은 PM A·B 공동 담당, C2는 PM C, C3는 PM A 단독.
  c1 = (await mkClient(ROOT, { name: "C1", pmIds: [pmA, pmB] })).id;
  c2 = (await mkClient(ROOT, { name: "C2", pmIds: [pmC] })).id;
  c3 = (await mkClient(ROOT, { name: "C3", pmIds: [pmA] })).id;
});

describe("submitWeekly — 고객사 카드 저장", () => {
  it("담당 PM이 처음 제출하면 저장되고 작성자·수정자가 본인이며 version 1, 수정 표시는 없다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.ok).toBe(true);
    expect(res.saved).toEqual([c1]);
    const row = (await rowOf(c1))!;
    expect(row.thisWeek).toBe("이번주 내용");
    expect(row.createdById).toBe(pmA);
    expect(row.updatedById).toBe(pmA);
    expect(row.version).toBe(1);
    expect(row.editedAt).toBeNull();
  });

  it("앞뒤 공백은 지우고 줄바꿈은 유지한다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "  첫줄\n둘째줄  " })], other: null });
    expect((await rowOf(c1))!.thisWeek).toBe("첫줄\n둘째줄");
  });

  it("'특이사항 없음'이면 내용을 비우고 작성 완료로 저장한다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { noSpecial: true })], other: null });
    const row = (await rowOf(c1))!;
    expect(row.noSpecial).toBe(true);
    expect([row.thisWeek, row.nextWeek, row.note]).toEqual(["", "", ""]);
  });

  it("비어 있는 새 카드는 저장하지 않는다", async () => {
    const res = await submitWeekly(ctxA, {
      weekStart: WEEK,
      entries: [entry(c1, { thisWeek: "", nextWeek: "" }), entry(c3)],
      other: null,
    });
    expect(res.skipped).toEqual([c1]);
    expect(res.saved).toEqual([c3]);
    expect(await rowOf(c1)).toBeNull();
  });

  it("같은 고객사라도 주가 다르면 별개 기록이다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    await submitWeekly(ctxA, { weekStart: WEEK2, entries: [entry(c1, { thisWeek: "다음 주차" })], other: null });
    expect((await rowOf(c1, WEEK))!.thisWeek).toBe("이번주 내용");
    expect((await rowOf(c1, WEEK2))!.thisWeek).toBe("다음 주차");
  });
});

describe("submitWeekly — 공동 담당 PM은 각자 자기 기록을 남긴다", () => {
  beforeEach(async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null }); // 작성자 A, version 1
  });

  it("같은 고객사·주라도 다른 담당 PM이 제출하면 A의 기록을 고치지 않고 B의 기록이 따로 생긴다", async () => {
    const res = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B의 일지" })], other: null });
    expect(res.saved).toEqual([c1]);
    expect(res.conflicts).toEqual([]);
    const a = (await rowOf(c1, WEEK, pmA))!;
    const b = (await rowOf(c1, WEEK, pmB))!;
    expect(a.thisWeek).toBe("이번주 내용");
    expect(a.version).toBe(1);
    expect(a.editedAt).toBeNull();
    expect(b.thisWeek).toBe("B의 일지");
    expect([b.createdById, b.updatedById, b.version]).toEqual([pmB, pmB, 1]);
    expect(await withRLS(ROOT, (tx) => tx.weeklyShare.count({ where: { clientId: c1 } }))).toBe(2);
  });

  it("내가 쓴 기록을 다시 제출하면 내 기록만 수정되고 작성자는 그대로, 수정 표시와 version이 갱신된다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "A가 고침", version: 1 })], other: null });
    expect(res.saved).toEqual([c1]);
    const row = (await rowOf(c1))!;
    expect([row.thisWeek, row.createdById, row.updatedById, row.version]).toEqual(["A가 고침", pmA, pmA, 2]);
    expect(row.editedAt).not.toBeNull();
  });

  it("내용이 같으면 저장하지 않아 시각·version이 그대로다", async () => {
    const before = (await rowOf(c1))!;
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { version: 1 })], other: null });
    expect(res.unchanged).toEqual([c1]);
    const after = (await rowOf(c1))!;
    expect(after.version).toBe(1);
    expect(after.editedAt).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("같은 사람이 낡은 화면(version)으로 제출하면 그 카드만 충돌이다(다른 카드는 정상 저장)", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "다른 탭에서 고침", version: 1 })], other: null }); // v2
    const res = await submitWeekly(ctxA, {
      weekStart: WEEK,
      entries: [entry(c1, { thisWeek: "낡은 탭에서 제출", version: 1 }), entry(c3)],
      other: null,
    });
    expect(res.ok).toBe(false);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ clientId: c1, updatedByName: "pma" });
    expect(res.saved).toEqual([c3]);
    expect((await rowOf(c1))!.thisWeek).toBe("다른 탭에서 고침");
  });

  it("기록이 없다고 보고 제출했는데 같은 사람이 그 사이 만들었으면 충돌이다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "덮어쓰기 시도", version: null })], other: null });
    expect(res.conflicts.map((c) => c.clientId)).toEqual([c1]);
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });

  it("이미 제출한 카드를 전부 비워 제출하면 막고 기록은 유지한다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "", nextWeek: "", version: 1 })], other: null });
    expect(res.rejected).toEqual([{ clientId: c1, reason: "EMPTY_EXISTING" }]);
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });

  it("담당자가 안 써도 한 명이 쓰면 그 고객사·주 기록이 존재한다(B는 쓰지 않음)", async () => {
    expect(await rowOf(c1, WEEK, pmB)).toBeNull();
    expect(await rowOf(c1, WEEK, pmA)).not.toBeNull();
  });
});

describe("submitWeekly — 쓰기 권한", () => {
  it("담당이 아닌 PM은 저장할 수 없다", async () => {
    const res = await submitWeekly(ctxC, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.rejected).toEqual([{ clientId: c1, reason: "NOT_ASSIGNED" }]);
    expect(await rowOf(c1)).toBeNull();
  });

  it("담당이 아닌 관리자(최고관리자·팀 관리자)는 그 고객사에 저장할 수 없다", async () => {
    for (const ctx of [ctxSuper, ctxAdminT1]) {
      const res = await submitWeekly(ctx, { weekStart: WEEK, entries: [entry(c1)], other: null });
      expect(res.rejected).toEqual([{ clientId: c1, reason: "NOT_ASSIGNED" }]);
    }
    expect(await rowOf(c1)).toBeNull();
  });

  it("담당 고객사를 맡은 최고관리자·팀 관리자는 PM처럼 본인 고객사에 저장할 수 있다", async () => {
    await withRLS(ROOT, async (tx) => {
      await tx.clientManager.create({ data: { clientId: c1, userId: superId } });
      await tx.clientManager.create({ data: { clientId: c3, userId: adminT1 } });
    });
    const a = await submitWeekly(ctxSuper, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "최고관리자 일지" })], other: null });
    expect(a.rejected).toEqual([]);
    expect(a.saved).toEqual([c1]);
    expect((await rowOf(c1))!.createdById).toBe(superId);
    const b = await submitWeekly(ctxAdminT1, { weekStart: WEEK, entries: [entry(c3, { thisWeek: "팀 관리자 일지" })], other: null });
    expect(b.saved).toEqual([c3]);
    expect((await rowOf(c3))!.thisWeek).toBe("팀 관리자 일지");
  });

  it("관리자도 담당이 아닌 고객사에는 DB(RLS)가 직접 쓰기를 막는다", async () => {
    await withRLS(ROOT, (tx) => tx.clientManager.create({ data: { clientId: c1, userId: superId } }));
    await expect(
      withRLS(ctxSuper, (tx) =>
        tx.weeklyShare.create({ data: { weekStart: new Date(WEEK), clientId: c2, createdById: superId, updatedById: superId } }),
      ),
    ).rejects.toThrow(); // c2는 담당이 아님
  });

  it("관리자는 기존 기록을 DB(RLS)에서도 수정할 수 없다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    for (const ctx of [ctxSuper, ctxAdminT1]) {
      const { count } = await withRLS(ctx, (tx) => tx.weeklyShare.updateMany({ where: { clientId: c1 }, data: { thisWeek: "관리자가 수정" } }));
      expect(count).toBe(0);
    }
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });

  it("공동 담당 PM이라도 다른 담당자가 쓴 기록은 DB(RLS)에서 수정할 수 없고 본인 기록은 수정할 수 있다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    const theirs = await withRLS(ctxB, (tx) =>
      tx.weeklyShare.updateMany({ where: { clientId: c1, createdById: pmA }, data: { thisWeek: "B가 A의 기록 수정", updatedById: pmB } }),
    );
    expect(theirs.count).toBe(0);
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
    const mine = await withRLS(ctxA, (tx) =>
      tx.weeklyShare.updateMany({ where: { clientId: c1, createdById: pmA }, data: { thisWeek: "A가 수정", updatedById: pmA } }),
    );
    expect(mine.count).toBe(1);
  });

  it("(주, 고객사, 작성자)는 DB에서도 1건만 존재하고, 같은 (주, 고객사)에 다른 작성자의 기록은 따로 둘 수 있다", async () => {
    const data = { weekStart: new Date(WEEK), clientId: c1, createdById: pmA, updatedById: pmA };
    await withRLS(ctxA, (tx) => tx.weeklyShare.create({ data }));
    await expect(withRLS(ctxA, (tx) => tx.weeklyShare.create({ data }))).rejects.toThrow();
    await withRLS(ctxB, (tx) => tx.weeklyShare.create({ data: { ...data, createdById: pmB, updatedById: pmB } }));
    expect(await withRLS(ROOT, (tx) => tx.weeklyShare.count({ where: { clientId: c1 } }))).toBe(2);
  });
});

describe("주간 공유 열람 범위(RLS)", () => {
  beforeEach(async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    await submitWeekly(ctxC, { weekStart: WEEK, entries: [entry(c2)], other: null });
  });
  const visible = (ctx: RlsContext) =>
    withRLS(ctx, (tx) => tx.weeklyShare.findMany({ select: { clientId: true } })).then((r) => r.map((x) => x.clientId).sort());

  it("PM은 자기 담당 고객사 기록만 본다(공동 담당 PM은 함께 본다)", async () => {
    expect(await visible(ctxA)).toEqual([c1]);
    expect(await visible(ctxB)).toEqual([c1]);
    expect(await visible(ctxC)).toEqual([c2]);
  });
  it("최고관리자는 전체, 팀 관리자는 자기 팀 PM의 고객사만, 파트장은 자기 소속 PM의 고객사만 본다", async () => {
    expect(await visible(ctxSuper)).toEqual([c1, c2].sort());
    expect(await visible(ctxAdminT1)).toEqual([c1]);
    expect(await visible(ctxAdminT2)).toEqual([c2]);
    expect(await visible(ctxLeader)).toEqual([c1]);
  });
  it("작성자 계정이 삭제돼도 기록은 남고 작성자만 비워진다", async () => {
    await prisma.user.delete({ where: { id: pmA } });
    const row = (await rowOf(c1))!;
    expect(row.thisWeek).toBe("이번주 내용");
    expect(row.createdById).toBeNull();
  });
});

describe("submitWeekly — 기타 업무", () => {
  const other = (over = {}) => ({ tags: ["TF"], thisWeek: "TF 회의", nextWeek: "", note: "", ...over });
  const otherRow = (authorId: string, weekStart = WEEK) =>
    withRLS(ROOT, (tx) => tx.weeklyOtherWork.findUnique({ where: { weekStart_authorId: { weekStart: new Date(weekStart), authorId } } }));

  it("PM별·주별로 1건 저장된다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    expect(res.other).toBe("saved");
    const row = (await otherRow(pmA))!;
    expect(row.tags).toEqual(["TF"]);
    expect(row.thisWeek).toBe("TF 회의");
    expect(row.editedAt).toBeNull();
  });

  it("같은 주에 다시 제출하면 같은 건을 갱신하고(수정 표시), 내용이 같으면 그대로 둔다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    const same = await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    expect(same.other).toBe("unchanged");
    expect((await otherRow(pmA))!.editedAt).toBeNull();
    const changed = await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other({ thisWeek: "TF 회의 2회" }) });
    expect(changed.other).toBe("saved");
    const row = (await otherRow(pmA))!;
    expect(row.thisWeek).toBe("TF 회의 2회");
    expect(row.editedAt).not.toBeNull();
    expect(await withRLS(ROOT, (tx) => tx.weeklyOtherWork.count())).toBe(1);
  });

  it("같은 PM이 동시에 두 번 제출해도 오류 없이 1건만 남고 함께 낸 고객사 카드도 저장된다", async () => {
    const send = () => submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c3)], other: other() });
    const [r1, r2] = await Promise.all([send(), send()]);
    expect([r1.other, r2.other].sort()).not.toContain("rejected");
    expect(await withRLS(ROOT, (tx) => tx.weeklyOtherWork.count())).toBe(1);
    expect((await rowOf(c3))?.thisWeek).toBe("이번주 내용");
  });

  it("비어 있으면 저장하지 않고, 이미 있는 것을 비우려 하면 막는다", async () => {
    const empty = other({ tags: [], thisWeek: "" });
    expect((await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: empty })).other).toBe("skipped");
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    expect((await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: empty })).other).toBe("rejected");
    expect((await otherRow(pmA))!.thisWeek).toBe("TF 회의");
  });

  it("관리자도 담당 고객사가 없어도 자기 기타 업무를 저장·수정할 수 있다", async () => {
    for (const [ctx, id] of [[ctxSuper, superId], [ctxAdminT1, adminT1]] as const) {
      expect((await submitWeekly(ctx, { weekStart: WEEK, entries: [], other: other() })).other).toBe("saved");
      expect((await otherRow(id))!.thisWeek).toBe("TF 회의");
      expect((await submitWeekly(ctx, { weekStart: WEEK, entries: [], other: other({ thisWeek: "수정" }) })).other).toBe("saved");
      expect((await otherRow(id))!.thisWeek).toBe("수정");
    }
  });

  it("관리자라도 다른 사람의 기타 업무는 DB(RLS)에서 수정할 수 없다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    const { count } = await withRLS(ctxSuper, (tx) => tx.weeklyOtherWork.updateMany({ where: { authorId: pmA }, data: { thisWeek: "남이 수정" } }));
    expect(count).toBe(0);
    expect((await otherRow(pmA))!.thisWeek).toBe("TF 회의");
  });

  it("다른 PM의 기타 업무는 DB(RLS)에서도 수정할 수 없다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    const { count } = await withRLS(ctxB, (tx) => tx.weeklyOtherWork.updateMany({ where: { authorId: pmA }, data: { thisWeek: "남이 수정" } }));
    expect(count).toBe(0);
  });

  describe("열람 범위", () => {
    beforeEach(async () => {
      await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other({ tags: ["타 고객사 지원"] }) });
      await submitWeekly(ctxB, { weekStart: WEEK, entries: [], other: other() });
    });
    const authors = (ctx: RlsContext) =>
      withRLS(ctx, (tx) => tx.weeklyOtherWork.findMany({ select: { authorId: true } })).then((r) => r.map((x) => x.authorId).sort());

    it("PM은 남의 기타 업무를 못 본다(자기 것만)", async () => {
      expect(await authors(ctxB)).toEqual([pmB]);
      expect(await authors(ctxC)).toEqual([]);
    });
    it("최고관리자는 전체, 팀 관리자는 자기 팀 PM, 파트장은 자기 소속 PM의 기록을 본다", async () => {
      expect(await authors(ctxSuper)).toEqual([pmA, pmB].sort());
      expect(await authors(ctxAdminT1)).toEqual([pmA, pmB].sort());
      expect(await authors(ctxLeader)).toEqual([pmA]);
    });
    it("다른 팀 관리자는 이 팀 PM의 기타 업무를 못 본다", async () => {
      expect(await authors(ctxAdminT2)).toEqual([]);
    });
  });
});

describe("submitWeekly — 최신 상태 반환", () => {
  it("저장한 카드의 최신 상태(version·작성자·수정자)를 돌려준다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.current[c1]).toMatchObject({
      version: 1, thisWeek: "이번주 내용", noSpecial: false, createdByName: "pma", updatedByName: "pma", editedAt: null,
    });
    const res2 = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "A가 고침", version: 1 })], other: null });
    expect(res2.current[c1]).toMatchObject({ version: 2, createdByName: "pma", updatedByName: "pma" });
    expect(res2.current[c1]!.editedAt).not.toBeNull();
  });

  it("공동 담당 PM의 기록과 섞이지 않고 내 기록만 돌려준다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "A의 일지" })], other: null });
    const res = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B의 일지" })], other: null });
    expect(res.current[c1]).toMatchObject({ thisWeek: "B의 일지", createdByName: "pmb", version: 1 });
  });

  it("충돌한 카드는 먼저 저장된 내 기록의 최신 내용을 돌려준다(내 입력은 저장하지 않음)", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "다른 탭에서 고침", version: 1 })], other: null });
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "낡은 입력", version: 1 })], other: null });
    expect(res.conflicts).toHaveLength(1);
    expect(res.current[c1]).toMatchObject({ version: 2, thisWeek: "다른 탭에서 고침", updatedByName: "pma" });
  });
});

describe("loadWeeklyBatch — 주간 공유 화면용 조회", () => {
  const params = (pmId: string, over = {}) => ({
    pmId, weekStart: WEEK, prevWeekStart: "2026-10-25", weeks: [WEEK, "2026-10-25"], ...over,
  });

  it("담당 고객사를 이름순으로, 이번 주 기록과 지난주 '다음주' 내용과 함께 돌려준다", async () => {
    await submitWeekly(ctxA, { weekStart: "2026-10-25", entries: [entry(c1, { thisWeek: "지난주 한 일", nextWeek: "이번주 하기로 한 일" })], other: null });
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.clients.map((c) => c.name)).toEqual(["C1", "C3"]);
    const c = data.clients[0];
    expect(c.share).toMatchObject({ thisWeek: "이번주 내용", version: 1, createdByName: "pma" });
    expect(c.prevNextWeek).toBe("이번주 하기로 한 일");
    expect(data.clients[1].share).toBeNull();
    expect(data.clients[1].prevNextWeek).toBe("");
  });

  it("주차별로 작성된 고객사 수를 센다(주차 칩의 진행 점)", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1), entry(c3)], other: null });
    await submitWeekly(ctxA, { weekStart: "2026-10-25", entries: [entry(c1)], other: null });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.weekStatus).toEqual({ [WEEK]: 2, "2026-10-25": 1 });
  });

  it("공동 담당자의 기록은 내 기록(share)이 아니라 읽기 전용 coShares로 돌려준다", async () => {
    await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B의 일지" })], other: null });
    const noMine = await loadWeeklyBatch(ctxA, params(pmA));
    const c = noMine.clients.find((x) => x.name === "C1")!;
    expect(c.share).toBeNull(); // A는 아직 안 씀
    expect(c.coShares.map((s) => [s.createdByName, s.thisWeek])).toEqual([["pmb", "B의 일지"]]);
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "A의 일지" })], other: null });
    const both = (await loadWeeklyBatch(ctxA, params(pmA))).clients.find((x) => x.name === "C1")!;
    expect(both.share).toMatchObject({ thisWeek: "A의 일지", createdByName: "pma" });
    expect(both.coShares.map((s) => s.createdByName)).toEqual(["pmb"]);
  });

  it("지난주 계획은 내 기록에서만 가져오고, 주차 칩은 한 명이라도 쓴 고객사를 한 번씩만 센다", async () => {
    await submitWeekly(ctxB, { weekStart: "2026-10-25", entries: [entry(c1, { nextWeek: "B의 계획" })], other: null });
    await submitWeekly(ctxA, { weekStart: "2026-10-25", entries: [entry(c1, { nextWeek: "A의 계획" })], other: null });
    await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1)], other: null }); // A는 이번 주에 안 씀
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.clients.find((x) => x.name === "C1")!.prevNextWeek).toBe("A의 계획");
    expect(data.weekStatus).toEqual({ [WEEK]: 1, "2026-10-25": 1 }); // 10/25의 C1은 둘이 썼어도 1곳
  });

  it("기타 업무를 함께 돌려준다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: { tags: ["TF"], thisWeek: "TF 회의", nextWeek: "", note: "" } });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.other).toMatchObject({ tags: ["TF"], thisWeek: "TF 회의" });
  });

  it("관리자는 다른 PM의 고객사를 그대로 조회한다(읽기)", async () => {
    await submitWeekly(ctxC, { weekStart: WEEK, entries: [entry(c2)], other: null });
    const data = await loadWeeklyBatch(ctxSuper, params(pmC));
    expect(data.clients.map((c) => c.name)).toEqual(["C2"]);
    expect(data.clients[0].share?.thisWeek).toBe("이번주 내용");
  });

  it("볼 권한이 없는 PM의 고객사는 돌려주지 않는다(RLS)", async () => {
    const data = await loadWeeklyBatch(ctxA, params(pmC));
    expect(data.clients).toEqual([]);
  });

  it("보관(삭제)된 고객사는 제외한다", async () => {
    await withRLS(ROOT, (tx) => tx.client.update({ where: { id: c3 }, data: { deletedAt: new Date() } }));
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.clients.map((c) => c.name)).toEqual(["C1"]);
  });
});

describe("loadWeeklyHistory — 히스토리용 조회", () => {
  const weeks = ["2026-10-25", WEEK];
  beforeEach(async () => {
    // 파트: A·B는 1파트, C는 2파트
    const p1 = await withRLS(ROOT, (tx) => tx.part.create({ data: { teamId: teamT1, name: "1파트", sortOrder: 1 } }));
    const p2 = await withRLS(ROOT, (tx) => tx.part.create({ data: { teamId: teamT2, name: "2파트", sortOrder: 2 } }));
    await prisma.user.updateMany({ where: { id: { in: [pmA, pmB] } }, data: { partId: p1.id } });
    await prisma.user.update({ where: { id: pmC }, data: { partId: p2.id } });
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1), entry(c3, { thisWeek: "C3 내용" })], other: { tags: ["TF"], thisWeek: "TF 회의", nextWeek: "", note: "" } });
    await submitWeekly(ctxC, { weekStart: "2026-10-25", entries: [entry(c2)], other: null });
  });

  it("PM을 파트 순서·이름순으로, 담당 고객사는 PM별로 돌려준다(공동 담당 고객사는 담당 PM 모두에게)", async () => {
    const data = await loadWeeklyHistory(ctxSuper, { pmIds: [pmC, pmB, pmA], weeks });
    expect(data.pms.map((p) => `${p.partName}/${p.name}`)).toEqual(["1파트/pma", "1파트/pmb", "2파트/pmc"]);
    expect(data.clientsByPm[pmA].map((c) => c.name).sort()).toEqual(["C1", "C3"]);
    expect(data.clientsByPm[pmB].map((c) => c.name)).toEqual(["C1"]); // C1은 A·B 공동 담당
    expect(data.clientsByPm[pmC].map((c) => c.name)).toEqual(["C2"]);
  });

  it("조회한 주의 기록만, 작성자 이름·주 키와 함께 돌려준다", async () => {
    const data = await loadWeeklyHistory(ctxSuper, { pmIds: [pmA, pmC], weeks });
    expect(data.shares.map((s) => `${s.clientId === c1 ? "C1" : s.clientId === c2 ? "C2" : "C3"}@${s.weekStart}`).sort()).toEqual([
      "C1@2026-11-01", "C2@2026-10-25", "C3@2026-11-01",
    ]);
    expect(data.shares.find((s) => s.clientId === c3)).toMatchObject({ thisWeek: "C3 내용", createdByName: "pma", version: 1 });
    expect(data.others).toHaveLength(1);
    expect(data.others[0]).toMatchObject({ authorId: pmA, weekStart: WEEK, tags: ["TF"] });
    const narrow = await loadWeeklyHistory(ctxSuper, { pmIds: [pmA, pmC], weeks: ["2026-10-25"] });
    expect(narrow.shares).toHaveLength(1);
    expect(narrow.others).toHaveLength(0);
  });

  it("공동 담당 고객사의 같은 주 기록은 작성자별로 따로 돌려준다(authorId 포함)", async () => {
    await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B의 일지" })], other: null });
    const data = await loadWeeklyHistory(ctxSuper, { pmIds: [pmA, pmB], weeks });
    const c1Shares = data.shares.filter((s) => s.clientId === c1 && s.weekStart === WEEK);
    expect(c1Shares.map((s) => [s.authorId, s.thisWeek]).sort()).toEqual([[pmA, "이번주 내용"], [pmB, "B의 일지"]].sort());
  });

  it("파트장 본인의 고객사·기록·기타 업무도 최고관리자와 같은 팀 관리자는 보고, 다른 팀 관리자는 못 본다", async () => {
    const c4 = (await mkClient(ROOT, { name: "C4", pmIds: [leaderL] })).id;
    await submitWeekly(ctxLeader, { weekStart: WEEK, entries: [entry(c4, { thisWeek: "파트장 일지" })], other: { tags: [], thisWeek: "파트장 기타", nextWeek: "", note: "" } });
    for (const ctx of [ctxSuper, ctxAdminT1]) {
      const data = await loadWeeklyHistory(ctx, { pmIds: [leaderL], weeks });
      expect(data.pms.map((p) => p.id)).toEqual([leaderL]);
      expect(data.clientsByPm[leaderL].map((c) => c.name)).toEqual(["C4"]);
      expect(data.shares.map((x) => x.thisWeek)).toEqual(["파트장 일지"]);
      expect(data.others.map((o) => o.thisWeek)).toEqual(["파트장 기타"]);
    }
    const otherTeam = await loadWeeklyHistory(ctxAdminT2, { pmIds: [leaderL], weeks });
    expect(otherTeam.clientsByPm[leaderL] ?? []).toEqual([]);
    expect(otherTeam.shares).toEqual([]);
    expect(otherTeam.others).toEqual([]);
  });

  it("PM은 자기 범위만 보인다(다른 PM의 고객사·기록은 RLS로 숨겨진다)", async () => {
    const data = await loadWeeklyHistory(ctxA, { pmIds: [pmA, pmC], weeks });
    expect(data.clientsByPm[pmC] ?? []).toEqual([]);
    expect(data.shares.every((s) => s.clientId !== c2)).toBe(true);
    expect(data.others.every((o) => o.authorId === pmA)).toBe(true);
  });

  it("팀 관리자는 자기 팀 PM의 기록만 본다", async () => {
    const data = await loadWeeklyHistory(ctxAdminT1, { pmIds: [pmA, pmB, pmC], weeks });
    expect(data.shares.map((s) => s.clientId).sort()).toEqual([c1, c3].sort());
  });

  it("보관(삭제)된 고객사는 제외한다", async () => {
    await withRLS(ROOT, (tx) => tx.client.update({ where: { id: c3 }, data: { deletedAt: new Date() } }));
    const data = await loadWeeklyHistory(ctxSuper, { pmIds: [pmA], weeks });
    expect(data.clientsByPm[pmA].map((c) => c.name)).toEqual(["C1"]);
  });
});
