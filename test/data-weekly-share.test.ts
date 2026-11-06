import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { submitWeekly, loadWeeklyBatch, listSupportClientOptions, type WeeklyEntryInput } from "@/lib/data/weekly-share";
import { mkClient, mkTask } from "./factories";

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
const rowOf = (clientId: string, weekStart = WEEK) =>
  withRLS(ROOT, (tx) => tx.weeklyShare.findUnique({ where: { weekStart_clientId: { weekStart: new Date(weekStart), clientId } } }));

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

describe("submitWeekly — 공동 담당 PM 수정과 충돌 방지", () => {
  beforeEach(async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null }); // version 1, 작성자 A
  });

  it("같은 고객사의 다른 담당 PM도 수정할 수 있고, 작성자는 유지되며 수정자·수정 표시가 갱신된다", async () => {
    const res = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B가 고침", version: 1 })], other: null });
    expect(res.saved).toEqual([c1]);
    const row = (await rowOf(c1))!;
    expect(row.thisWeek).toBe("B가 고침");
    expect(row.createdById).toBe(pmA);
    expect(row.updatedById).toBe(pmB);
    expect(row.version).toBe(2);
    expect(row.editedAt).not.toBeNull();
  });

  it("내용이 같으면 저장하지 않아 시각·수정자·version이 그대로다", async () => {
    const before = (await rowOf(c1))!;
    const res = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { version: 1 })], other: null });
    expect(res.unchanged).toEqual([c1]);
    const after = (await rowOf(c1))!;
    expect(after.version).toBe(1);
    expect(after.editedAt).toBeNull();
    expect(after.updatedById).toBe(pmA);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("그 사이 다른 PM이 저장했으면 그 카드만 저장하지 않고 충돌로 알린다(다른 카드는 정상 저장)", async () => {
    // B가 먼저 고쳐 v2가 된 뒤, 낡은 화면(v1)을 가진 A가 C1과 C3를 함께 제출한다.
    await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B가 고침", version: 1 })], other: null });
    const res = await submitWeekly(ctxA, {
      weekStart: WEEK,
      entries: [entry(c1, { thisWeek: "A의 낡은 화면에서 제출", version: 1 }), entry(c3)],
      other: null,
    });
    expect(res.ok).toBe(false);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ clientId: c1, updatedByName: "pmb" });
    expect(res.saved).toEqual([c3]);
    expect((await rowOf(c1))!.thisWeek).toBe("B가 고침");
  });

  it("기록이 없다고 보고 제출했는데 그 사이 누가 만들었으면 충돌이다", async () => {
    const res = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "덮어쓰기 시도", version: null })], other: null });
    expect(res.conflicts.map((c) => c.clientId)).toEqual([c1]);
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });

  it("이미 제출한 카드를 전부 비워 제출하면 막고 기록은 유지한다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "", nextWeek: "", version: 1 })], other: null });
    expect(res.rejected).toEqual([{ clientId: c1, reason: "EMPTY_EXISTING" }]);
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });
});

describe("submitWeekly — 쓰기 권한", () => {
  it("담당이 아닌 PM은 저장할 수 없다", async () => {
    const res = await submitWeekly(ctxC, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.rejected).toEqual([{ clientId: c1, reason: "NOT_ASSIGNED" }]);
    expect(await rowOf(c1)).toBeNull();
  });

  it("관리자(최고관리자·팀 관리자)는 저장할 수 없다", async () => {
    for (const ctx of [ctxSuper, ctxAdminT1]) {
      const res = await submitWeekly(ctx, { weekStart: WEEK, entries: [entry(c1)], other: null });
      expect(res.rejected).toEqual([{ clientId: c1, reason: "NOT_ASSIGNED" }]);
    }
    expect(await rowOf(c1)).toBeNull();
  });

  it("담당으로 배정된 최고관리자라도 DB(RLS)가 직접 쓰기를 막는다", async () => {
    await withRLS(ROOT, (tx) => tx.clientManager.create({ data: { clientId: c1, userId: superId } }));
    await expect(
      withRLS(ctxSuper, (tx) =>
        tx.weeklyShare.create({ data: { weekStart: new Date(WEEK), clientId: c1, createdById: superId, updatedById: superId } }),
      ),
    ).rejects.toThrow();
    const res = await submitWeekly(ctxSuper, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.rejected[0].reason).toBe("NOT_ASSIGNED"); // 앱 계층도 관리자 역할은 거부
  });

  it("관리자는 기존 기록을 DB(RLS)에서도 수정할 수 없다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    for (const ctx of [ctxSuper, ctxAdminT1]) {
      const { count } = await withRLS(ctx, (tx) => tx.weeklyShare.updateMany({ where: { clientId: c1 }, data: { thisWeek: "관리자가 수정" } }));
      expect(count).toBe(0);
    }
    expect((await rowOf(c1))!.thisWeek).toBe("이번주 내용");
  });

  it("(주, 고객사)는 DB에서도 1건만 존재한다", async () => {
    const data = { weekStart: new Date(WEEK), clientId: c3, createdById: pmA, updatedById: pmA };
    await withRLS(ctxA, (tx) => tx.weeklyShare.create({ data }));
    await expect(withRLS(ctxA, (tx) => tx.weeklyShare.create({ data }))).rejects.toThrow();
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
  const other = (over = {}) => ({ tags: ["TF"], thisWeek: "TF 회의", nextWeek: "", note: "", supportClientId: null as string | null, ...over });
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

  it("비어 있으면 저장하지 않고, 이미 있는 것을 비우려 하면 막는다", async () => {
    const empty = other({ tags: [], thisWeek: "" });
    expect((await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: empty })).other).toBe("skipped");
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    expect((await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: empty })).other).toBe("rejected");
    expect((await otherRow(pmA))!.thisWeek).toBe("TF 회의");
  });

  it("관리자는 기타 업무를 저장할 수 없다", async () => {
    expect((await submitWeekly(ctxSuper, { weekStart: WEEK, entries: [], other: other() })).other).toBe("rejected");
    expect(await withRLS(ROOT, (tx) => tx.weeklyOtherWork.count())).toBe(0);
  });

  it("다른 PM의 기타 업무는 DB(RLS)에서도 수정할 수 없다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other() });
    const { count } = await withRLS(ctxB, (tx) => tx.weeklyOtherWork.updateMany({ where: { authorId: pmA }, data: { thisWeek: "남이 수정" } }));
    expect(count).toBe(0);
  });

  describe("열람 범위와 지원 줄", () => {
    beforeEach(async () => {
      // A: 고객사 C2(=PM C 담당)를 지원한 기록 / A: 같은 주의 다른 PM B는 지원 없이 TF 기록
      await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: other({ tags: ["타 고객사 지원"], supportClientId: c2 }) });
      await submitWeekly(ctxB, { weekStart: WEEK, entries: [], other: other() });
    });
    const authors = (ctx: RlsContext) =>
      withRLS(ctx, (tx) => tx.weeklyOtherWork.findMany({ select: { authorId: true } })).then((r) => r.map((x) => x.authorId).sort());

    it("지원 대상 고객사를 볼 수 있는 PM은 그 지원 기록을 본다(다른 기록은 못 본다)", async () => {
      expect(await authors(ctxC)).toEqual([pmA]);
    });
    it("지원과 무관한 PM은 남의 기타 업무를 못 본다(자기 것만)", async () => {
      expect(await authors(ctxB)).toEqual([pmB]);
    });
    it("최고관리자는 전체, 팀 관리자는 자기 팀 PM, 파트장은 자기 소속 PM의 기록을 본다", async () => {
      expect(await authors(ctxSuper)).toEqual([pmA, pmB].sort());
      expect(await authors(ctxAdminT1)).toEqual([pmA, pmB].sort());
      expect(await authors(ctxLeader)).toEqual([pmA]);
    });
    it("다른 팀 관리자는 지원 대상 고객사를 볼 수 있는 경우에만 그 기록을 본다", async () => {
      expect(await authors(ctxAdminT2)).toEqual([pmA]); // T2의 PM C 담당 고객사 C2를 지원한 기록
    });
  });
});

describe("submitWeekly — 실적 횟수 동시 저장과 최신 상태 반환", () => {
  it("실적 횟수를 함께 제출하면 같은 월별 실적(MonthlyPerformance)에 저장된다", async () => {
    const t = await mkTask(ROOT, { clientId: c1, name: "심리진단", unitPrice: 1000 });
    const res = await submitWeekly(ctxA, {
      weekStart: WEEK, entries: [entry(c1)], other: null,
      performance: [{ clientId: c1, year: 2026, month: 11, rows: [{ taskId: t.id, count: 3, amount: null }] }],
    });
    expect(res.saved).toEqual([c1]);
    const perf = await withRLS(ROOT, (tx) => tx.monthlyPerformance.findMany({ where: { taskId: t.id } }));
    expect(perf).toHaveLength(1);
    expect(perf[0]).toMatchObject({ year: 2026, month: 11, count: 3, amount: 3000 });
  });

  it("실적 저장이 실패하면(다른 고객사 과업) 주간 공유 텍스트도 함께 저장되지 않는다", async () => {
    const foreign = await mkTask(ROOT, { clientId: c2, name: "타사 과업", unitPrice: 500 });
    await expect(
      submitWeekly(ctxA, {
        weekStart: WEEK, entries: [entry(c1)], other: null,
        performance: [{ clientId: c1, year: 2026, month: 11, rows: [{ taskId: foreign.id, count: 1, amount: null }] }],
      }),
    ).rejects.toThrow();
    expect(await rowOf(c1)).toBeNull();
  });

  it("저장한 카드의 최신 상태(version·작성자·수정자)를 돌려준다", async () => {
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    expect(res.current[c1]).toMatchObject({
      version: 1, thisWeek: "이번주 내용", noSpecial: false, createdByName: "pma", updatedByName: "pma", editedAt: null,
    });
    const res2 = await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B가 고침", version: 1 })], other: null });
    expect(res2.current[c1]).toMatchObject({ version: 2, createdByName: "pma", updatedByName: "pmb" });
    expect(res2.current[c1]!.editedAt).not.toBeNull();
  });

  it("충돌한 카드는 다른 PM이 저장한 최신 내용을 돌려준다(내 입력은 저장하지 않음)", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1)], other: null });
    await submitWeekly(ctxB, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "B가 고침", version: 1 })], other: null });
    const res = await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1, { thisWeek: "A의 낡은 입력", version: 1 })], other: null });
    expect(res.conflicts).toHaveLength(1);
    expect(res.current[c1]).toMatchObject({ version: 2, thisWeek: "B가 고침", updatedByName: "pmb" });
  });
});

describe("loadWeeklyBatch — 주간 공유 화면용 조회", () => {
  const params = (pmId: string, over = {}) => ({
    pmId, weekStart: WEEK, prevWeekStart: "2026-10-25", year: 2026, month: 11, weeks: [WEEK, "2026-10-25"], ...over,
  });

  it("담당 고객사를 이름순으로, 이번 주 기록과 지난주 '다음주' 내용·월 실적과 함께 돌려준다", async () => {
    const t = await mkTask(ROOT, { clientId: c1, name: "심리진단", unitPrice: 1000 });
    await submitWeekly(ctxA, { weekStart: "2026-10-25", entries: [entry(c1, { thisWeek: "지난주 한 일", nextWeek: "이번주 하기로 한 일" })], other: null });
    await submitWeekly(ctxA, {
      weekStart: WEEK, entries: [entry(c1)], other: null,
      performance: [{ clientId: c1, year: 2026, month: 11, rows: [{ taskId: t.id, count: 2, amount: null }] }],
    });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.clients.map((c) => c.name)).toEqual(["C1", "C3"]);
    const c = data.clients[0];
    expect(c.share).toMatchObject({ thisWeek: "이번주 내용", version: 1, createdByName: "pma" });
    expect(c.prevNextWeek).toBe("이번주 하기로 한 일");
    expect(c.monthAmount).toBe(2000);
    expect(c.tasks).toEqual([{ id: t.id, name: "심리진단", unitPrice: 1000, count: 2, amount: 2000 }]);
    expect(data.clients[1].share).toBeNull();
    expect(data.clients[1].prevNextWeek).toBe("");
  });

  it("주차별로 작성된 고객사 수를 센다(주차 칩의 진행 점)", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [entry(c1), entry(c3)], other: null });
    await submitWeekly(ctxA, { weekStart: "2026-10-25", entries: [entry(c1)], other: null });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.weekStatus).toEqual({ [WEEK]: 2, "2026-10-25": 1 });
  });

  it("기타 업무를 함께 돌려준다", async () => {
    await submitWeekly(ctxA, { weekStart: WEEK, entries: [], other: { tags: ["TF"], thisWeek: "TF 회의", nextWeek: "", note: "", supportClientId: c2 } });
    const data = await loadWeeklyBatch(ctxA, params(pmA));
    expect(data.other).toMatchObject({ tags: ["TF"], thisWeek: "TF 회의", supportClientId: c2 });
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

describe("listSupportClientOptions — 지원 나간 고객사 선택 목록", () => {
  it("PM은 자기 담당이 아닌 활성 고객사의 이름만 받는다", async () => {
    const opts = await listSupportClientOptions(ctxA);
    expect(opts.map((o) => o.name)).toEqual(["C2"]);
    expect(Object.keys(opts[0]).sort()).toEqual(["id", "name"]);
  });
  it("보관된 고객사는 제외한다", async () => {
    await withRLS(ROOT, (tx) => tx.client.update({ where: { id: c2 }, data: { deletedAt: new Date() } }));
    expect(await listSupportClientOptions(ctxA)).toEqual([]);
  });
  it("관리자는 이름 표시용으로 전체 고객사를 받는다", async () => {
    expect((await listSupportClientOptions(ctxSuper)).map((o) => o.name)).toEqual(["C1", "C2", "C3"]);
  });
  it("조회 허용 범위를 일반 조회로는 넓히지 않는다(PM의 고객사 조회는 여전히 담당 고객사만)", async () => {
    await listSupportClientOptions(ctxA);
    const rows = await withRLS(ctxA, (tx) => tx.client.findMany({ select: { name: true } }));
    expect(rows.map((r) => r.name).sort()).toEqual(["C1", "C3"]);
  });
});
