import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { loadPartStatusFacts } from "@/lib/data/part-status";
import { getContractTotal, getMonthlyTrend, getPeriodTotals } from "@/lib/data/metrics";
import { totalsFor, type PartStatusInput } from "@/lib/part-status";
import { mkClient, mkTask } from "./factories";

const ROOT: RlsContext = { userId: "seed-admin", role: "SUPER_ADMIN" };
const YEAR = 2026;
const yearWindow = (y: number) => ({ from: { year: y, month: 1 }, to: { year: y, month: 12 } });

let pmA: string, pmB: string, pmC: string, adminT1: string;
let teamT1: string, teamT2: string;
let cX: string, cY: string, cZ: string;
let ctxSuper: RlsContext, ctxAdminT1: RlsContext, ctxPmA: RlsContext;

const perf = (taskId: string, year: number, month: number, amount: number) =>
  withRLS(ROOT, (tx) => tx.monthlyPerformance.create({ data: { taskId, year, month, amount, count: null } }));

beforeEach(async () => {
  await withRLS(ROOT, async (tx) => {
    await tx.$executeRawUnsafe('TRUNCATE TABLE "WeeklyShare", "WeeklyOtherWork"');
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
    await tx.team.deleteMany();
  });
  await prisma.user.deleteMany();
  teamT1 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T1" } }))).id;
  teamT2 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T2" } }))).id;
  const mk = (email: string, role: "PM" | "ADMIN", teamId: string) =>
    prisma.user.create({ data: { email, name: email.split("@")[0], role, status: "ACTIVE", teamId } }).then((u) => u.id);
  pmA = await mk("pma@huno.kr", "PM", teamT1);
  pmB = await mk("pmb@huno.kr", "PM", teamT1);
  pmC = await mk("pmc@huno.kr", "PM", teamT2);
  adminT1 = await mk("admt1@huno.kr", "ADMIN", teamT1);
  ctxSuper = { userId: "seed-admin", role: "SUPER_ADMIN" };
  ctxAdminT1 = { userId: adminT1, role: "ADMIN", teamId: teamT1 };
  ctxPmA = { userId: pmA, role: "PM", teamId: teamT1 };

  // X: 올해 전체 계약(1~12월), A·B 공동 담당 / Y: 7월~내년 6월 계약(올해 6/12 귀속), C 담당 / Z: 보관(삭제)된 고객사
  cX = (await mkClient(ROOT, { name: "X사", pmIds: [pmA, pmB], contractStart: new Date(2026, 0, 1), contractEnd: new Date(2026, 11, 31) })).id;
  cY = (await mkClient(ROOT, { name: "Y사", pmIds: [pmC], contractStart: new Date(2026, 6, 1), contractEnd: new Date(2027, 5, 30) })).id;
  cZ = (await mkClient(ROOT, { name: "Z사", pmIds: [pmA], contractStart: new Date(2026, 0, 1), contractEnd: new Date(2026, 11, 31) })).id;
  const tx1 = await mkTask(ROOT, { clientId: cX, name: "과세", unitPrice: 1, contractAmount: 1200 });
  const tx2 = await mkTask(ROOT, { clientId: cX, name: "면세", unitPrice: 1, contractAmount: 600, vatExempt: true });
  const ty = await mkTask(ROOT, { clientId: cY, name: "과세", unitPrice: 1, contractAmount: 1200 });
  const tz = await mkTask(ROOT, { clientId: cZ, name: "과세", unitPrice: 1, contractAmount: 5000 });
  await perf(tx1.id, YEAR, 1, 100);
  await perf(tx1.id, YEAR, 2, 200);
  await perf(tx1.id, YEAR - 1, 12, 999); // 작년 실적은 제외
  await perf(tx2.id, YEAR, 1, 50);
  await perf(ty.id, YEAR, 8, 300);
  await perf(tz.id, YEAR, 3, 7777);
  await withRLS(ROOT, (tx) => tx.client.update({ where: { id: cZ }, data: { deletedAt: new Date() } }));
});

describe("loadPartStatusFacts — 파트 현황 원자료", () => {
  it("PM별 담당 고객사(공동 담당은 모두에게), 보관된 고객사는 제외", async () => {
    const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA, pmB, pmC], ...yearWindow(YEAR) });
    expect(f.clientsByPm[pmA]).toEqual([cX]);
    expect(f.clientsByPm[pmB]).toEqual([cX]);
    expect(f.clientsByPm[pmC]).toEqual([cY]);
    expect(f.clients[cZ]).toBeUndefined();
  });

  it("올해 월별 실적을 과세/면세로 나눠 담고 다른 해는 제외한다", async () => {
    const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA], ...yearWindow(YEAR) });
    const x = f.clients[cX];
    expect(x.name).toBe("X사");
    expect(x.perfTaxable).toHaveLength(12);
    expect(x.perfTaxable.slice(0, 3)).toEqual([100, 200, 0]);
    expect(x.perfExempt[0]).toBe(50);
    expect(x.perfTaxable.reduce((a, b) => a + b, 0)).toBe(300); // 작년 999 제외
  });

  it("계약금은 계약기간 월수 비례로 올해 귀속분만, 과세/면세를 나눠 담는다", async () => {
    const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA, pmC], ...yearWindow(YEAR) });
    expect(f.clients[cX]).toMatchObject({ contractTaxable: 1200, contractExempt: 600 });
    expect(f.clients[cY].contractTaxable).toBeCloseTo(600); // 12개월 중 올해 6개월
    expect(f.clients[cY].contractExempt).toBe(0);
    const next = await loadPartStatusFacts(ctxSuper, { pmIds: [pmC], ...yearWindow(YEAR + 1) });
    expect(next.clients[cY].contractTaxable).toBeCloseTo(600); // 내년 6개월
  });

  it("월 구간(해를 넘어도 됨): 실적 배열은 구간의 월 순서에 맞추고, 계약금은 구간 몫만 귀속한다", async () => {
    // 2026-02 ~ 2026-08 (7개월): X는 12개월 계약 중 7개월분, Y(2026-07~2027-06)는 7·8월 2개월분
    const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA, pmC], from: { year: 2026, month: 2 }, to: { year: 2026, month: 8 } });
    expect(f.months).toHaveLength(7);
    expect(f.clients[cX].perfTaxable).toEqual([200, 0, 0, 0, 0, 0, 0]); // 2월 200, 1월은 구간 밖
    expect(f.clients[cY].perfTaxable[6]).toBe(300); // 8월
    expect(f.clients[cX].contractTaxable).toBeCloseTo((1200 * 7) / 12);
    expect(f.clients[cX].contractExempt).toBeCloseTo((600 * 7) / 12);
    expect(f.clients[cY].contractTaxable).toBeCloseTo((1200 * 2) / 12);
  });

  it("해를 넘는 구간: 작년 12월 실적(첫 칸)과 올해 1월 실적(둘째 칸)이 이어진다", async () => {
    const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA], from: { year: 2025, month: 12 }, to: { year: 2026, month: 1 } });
    expect(f.clients[cX].perfTaxable).toEqual([999, 100]);
    expect(f.clients[cX].perfExempt).toEqual([0, 50]);
  });

  it("권한 범위: 팀 관리자는 자기 팀 PM의 고객사만, PM은 본인 담당만 읽힌다", async () => {
    const team = await loadPartStatusFacts(ctxAdminT1, { pmIds: [pmA, pmB, pmC], ...yearWindow(YEAR) });
    expect(Object.keys(team.clients)).toEqual([cX]);
    expect(team.clientsByPm[pmC] ?? []).toEqual([]);
    const own = await loadPartStatusFacts(ctxPmA, { pmIds: [pmA, pmC], ...yearWindow(YEAR) });
    expect(Object.keys(own.clients)).toEqual([cX]);
  });
});

// 약속: 파트 현황의 "전체" 숫자는 전체 현황(전사 대시보드)의 계산식과 같다. 같은 데이터로 두 쪽을 직접 비교한다.
describe("전체 현황과의 일치", () => {
  for (const includeVat of [false, true]) {
    it(`부가세 ${includeVat ? "포함" : "미포함"}: 누적 실적·계약금·월별 실적이 전체 현황과 같다`, async () => {
      const f = await loadPartStatusFacts(ctxSuper, { pmIds: [pmA, pmB, pmC], ...yearWindow(YEAR) });
      const input: PartStatusInput = {
        groups: [{ id: "g", name: "전체" }],
        pms: [pmA, pmB, pmC].map((id) => ({ id, name: id, groupId: "g" })),
        clientsByPm: f.clientsByPm,
        clients: f.clients,
        includeVat,
      };
      const mine = totalsFor(input, Object.keys(f.clients));
      const totals = await getPeriodTotals(ctxSuper, YEAR, "all", includeVat);
      const contract = await getContractTotal(ctxSuper, YEAR, "all", includeVat);
      const trend = await getMonthlyTrend(ctxSuper, YEAR, includeVat);
      expect(mine.cumulative).toBe(totals.performance);
      expect(mine.contract).toBe(contract);
      expect(mine.months).toEqual(trend.map((t) => t.performance));
    });
  }
});
