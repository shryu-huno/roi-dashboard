// 사업운영팀 아래 1·2·3파트를 만들고, 파트장과 PM을 파트에 배정하는 1회성(멱등) 스크립트.
//
//   node scripts/setup-business-ops-parts.mjs            # 드라이런: 바뀔 내용만 출력(DB 변경 없음)
//   node scripts/setup-business-ops-parts.mjs --apply    # 실제 반영
//
// 대상 DB는 .env의 DATABASE_URL(또는 셸에 지정한 DATABASE_URL)이다. 실행 전에 접속 대상을 출력한다.
// 배분 규칙: 각 파트장(박영걸=1파트, 문지혜=2파트, 이지연=3파트)에게 현재 소속된 PM(partLeaderId)을
// 그 파트장의 파트로 옮긴다. PM의 partLeaderId는 이미 그 파트장이므로 권한(RLS)은 바뀌지 않는다.
// 파트장이 없거나 다른 파트장 소속이거나 팀이 다른 PM은 옮기지 않고 목록으로 알려 준다.
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config({ quiet: true });

const TEAM_NAME = "사업운영팀";
const PLAN = [
  { part: "1파트", leader: "박영걸" },
  { part: "2파트", leader: "문지혜" },
  { part: "3파트", leader: "이지연" },
];
const apply = process.argv.includes("--apply");

const prisma = new PrismaClient();
const url = new URL(process.env.DATABASE_URL);
console.log(`대상 DB: ${url.hostname}:${url.port}${url.pathname}  (${apply ? "반영 모드" : "드라이런 — 변경 없음"})\n`);

const label = (u) => `${u.name ?? "(이름없음)"} <${u.email}>`;

async function main() {
  const team = await prisma.team.findFirst({ where: { name: TEAM_NAME } });
  if (!team) throw new Error(`'${TEAM_NAME}' 팀을 찾을 수 없습니다. 팀 관리에서 먼저 만들어 주세요.`);

  const existingParts = await prisma.part.findMany({ where: { teamId: team.id } });
  const partByName = new Map(existingParts.map((p) => [p.name, p]));

  const leaders = [];
  for (const { part, leader } of PLAN) {
    const found = await prisma.user.findMany({ where: { name: leader, role: "PART_LEADER", status: "ACTIVE" } });
    if (found.length !== 1) {
      throw new Error(`파트장 '${leader}'을(를) 활성 파트장 1명으로 특정할 수 없습니다(검색 결과 ${found.length}명).`);
    }
    leaders.push({ part, user: found[0] });
  }

  console.log(`팀: ${team.name}`);
  const moves = [];
  const skipped = [];
  for (const { part, user } of leaders) {
    console.log(`\n[${part}] ${partByName.has(part) ? "이미 있음" : "새로 만듦"} · 파트장 ${label(user)}`);
    const pms = await prisma.user.findMany({ where: { role: "PM", partLeaderId: user.id }, orderBy: { name: "asc" } });
    for (const pm of pms) {
      if (pm.teamId !== team.id) {
        skipped.push(`${label(pm)} — 팀이 '${TEAM_NAME}'이 아니어서 건너뜀(${part} 파트장 소속)`);
        continue;
      }
      console.log(`   PM ${label(pm)}`);
      moves.push({ pm, part });
    }
    if (pms.length === 0) console.log("   (소속 PM 없음)");
  }

  const leaderIds = leaders.map((l) => l.user.id);
  const orphans = await prisma.user.findMany({
    // partLeaderId가 NULL인 PM도 포함해야 한다(SQL의 NOT IN은 NULL을 제외하므로 OR로 명시).
    where: {
      role: "PM", status: "ACTIVE", teamId: team.id,
      OR: [{ partLeaderId: null }, { partLeaderId: { notIn: leaderIds } }],
    },
    orderBy: { name: "asc" },
  });
  console.log(`\n파트에 배정되지 않는 ${TEAM_NAME} PM: ${orphans.length}명`);
  for (const o of orphans) console.log(`   ${label(o)}${o.partLeaderId ? " — 위 세 파트장 외 다른 파트장 소속" : " — 소속 파트장 없음"}`);
  for (const s of skipped) console.log(`   ${s}`);

  if (!apply) {
    console.log("\n드라이런이 끝났습니다. 위 내용이 맞으면 --apply 로 다시 실행하세요.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Part 쓰기 RLS(최고관리자 전용)를 통과하도록 앱과 같은 방식으로 컨텍스트를 주입한다.
    await tx.$executeRaw`SELECT set_config('app.user_role', 'SUPER_ADMIN', true), set_config('app.user_id', 'setup-script', true), set_config('app.team_id', '', true)`;
    const ids = new Map();
    let order = 0;
    for (const { part } of PLAN) {
      order += 1;
      const row = await tx.part.upsert({
        where: { teamId_name: { teamId: team.id, name: part } },
        update: {},
        create: { teamId: team.id, name: part, sortOrder: order },
      });
      ids.set(part, row.id);
    }
    for (const { part, user } of leaders) {
      await tx.user.update({ where: { id: user.id }, data: { partId: ids.get(part), teamId: team.id } });
    }
    for (const { pm, part } of moves) {
      await tx.user.update({ where: { id: pm.id }, data: { partId: ids.get(part) } });
    }
  });
  console.log("\n반영했습니다.");
}

main()
  .catch((e) => {
    console.error(`\n중단: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
