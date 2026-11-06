import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS, type RlsContext } from "@/lib/rls";
import { loadAdminLists } from "@/app/(app)/weekly-share/range";

const ROOT: RlsContext = { userId: "seed-admin", role: "SUPER_ADMIN" };
type Role = "PM" | "ADMIN" | "PART_LEADER" | "SUPER_ADMIN";
const sessionOf = (u: { id: string; role: Role; teamId: string | null; name: string | null; email: string }) =>
  ({ id: u.id, role: u.role, status: "ACTIVE" as const, teamId: u.teamId, name: u.name, email: u.email });

let team1: string, team2: string, p1: string, p2: string;
const ids: Record<string, string> = {};

beforeEach(async () => {
  await withRLS(ROOT, async (tx) => {
    await tx.team.deleteMany(); // Part는 팀 삭제로 함께 정리
  });
  await prisma.user.deleteMany();
  team1 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T1" } }))).id;
  team2 = (await withRLS(ROOT, (tx) => tx.team.create({ data: { name: "T2" } }))).id;
  p1 = (await withRLS(ROOT, (tx) => tx.part.create({ data: { teamId: team1, name: "1파트", sortOrder: 1 } }))).id;
  p2 = (await withRLS(ROOT, (tx) => tx.part.create({ data: { teamId: team1, name: "2파트", sortOrder: 2 } }))).id;
  const mk = async (key: string, role: Role, extra: object = {}) => {
    ids[key] = (await prisma.user.create({ data: { email: `${key}@huno.kr`, name: key, role, status: "ACTIVE", ...extra } })).id;
  };
  await mk("leader1", "PART_LEADER", { teamId: team1, partId: p1 });
  await mk("pmA", "PM", { teamId: team1, partId: p1 });
  await mk("pmB", "PM", { teamId: team1, partId: p1 });
  await mk("pmC", "PM", { teamId: team1, partId: p2 });
  await mk("pmD", "PM", { teamId: team1 }); // 파트 미지정
  await mk("pmE", "PM", { teamId: team2 }); // 다른 팀
  await mk("leaderNoPart", "PART_LEADER", { teamId: team1 });
  await mk("admin1", "ADMIN", { teamId: team1 });
  await mk("super", "SUPER_ADMIN");
});

const user = async (key: string) => sessionOf((await prisma.user.findUniqueOrThrow({ where: { id: ids[key] } })) as never);

describe("loadAdminLists — 역할별로 고를 수 있는 파트·PM", () => {
  it("파트장: 본인 파트 하나와 그 파트의 PM + 본인(구성원)만", async () => {
    const l = await loadAdminLists(await user("leader1"));
    expect(l.parts.map((p) => p.name)).toEqual(["1파트"]);
    expect(l.pms.map((p) => p.name).sort()).toEqual(["leader1", "pmA", "pmB"]);
    expect(l.pms.every((p) => p.partId === p1)).toBe(true);
  });
  it("소속 파트가 없는 파트장: 파트 없음, 본인만(본인 고객사 기록은 볼 수 있다)", async () => {
    const l = await loadAdminLists(await user("leaderNoPart"));
    expect(l.parts).toEqual([]);
    expect(l.pms.map((p) => p.name)).toEqual(["leaderNoPart"]);
  });
  it("팀 관리자는 자기 팀의 파트와 PM, 최고관리자는 전체(기존 동작)", async () => {
    const team = await loadAdminLists(await user("admin1"));
    expect(team.parts.map((p) => p.name)).toEqual(["1파트", "2파트"]);
    expect(team.pms.map((p) => p.name)).not.toContain("pmE");
    const all = await loadAdminLists(await user("super"));
    expect(all.pms.map((p) => p.name)).toContain("pmE");
  });
});
