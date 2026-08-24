// 횟수 모드(count!=null) 실적 금액을 현재 과업 단가로 다시 계산하는 1회성 백필.
// 배경: 과거에는 실적 저장 시 amount=단가×횟수를 스냅샷으로 굳혔고, 이후 단가를 바꿔도
// 과거 실적 금액이 옛 단가로 남아 있었다. 코드는 이제 단가 변경 시 자동 재계산하지만,
// 이 스크립트는 그 전에 쌓인 기존 데이터를 한 번에 교정한다.
// roi_app 롤은 RLS가 걸려 있으므로 withRLS와 동일하게 SUPER_ADMIN 컨텍스트를 주입해 실행한다.
//
// 사용법(로컬 dev DB 대상):  node scripts/backfill-performance-amounts.js [--apply]
//   --apply 없이 실행하면 dry-run(변경 대상 건수만 출력).

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

const DIVERGED_WHERE = `mp."count" IS NOT NULL AND mp."amount" <> mp."count" * t."unitPrice"`;

async function main() {
  await prisma.$transaction(async (tx) => {
    // withRLS와 동일한 컨텍스트 주입(전체 접근).
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.user_id',$1,true), set_config('app.user_role',$2,true), set_config('app.team_id',$3,true)",
      "backfill-admin",
      "SUPER_ADMIN",
      "",
    );

    const diverged = await tx.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "MonthlyPerformance" mp JOIN "Task" t ON t.id = mp."taskId" WHERE ${DIVERGED_WHERE}`,
    );
    const n = diverged[0].n;
    console.log(`옛 단가로 남아 어긋난 횟수 모드 실적 행: ${n}건`);

    if (!APPLY) {
      console.log("dry-run 입니다. 실제 교정은 --apply 로 다시 실행하세요.");
      return;
    }

    const updated = await tx.$executeRawUnsafe(
      `UPDATE "MonthlyPerformance" mp SET "amount" = mp."count" * t."unitPrice", "updatedAt" = now() FROM "Task" t WHERE mp."taskId" = t.id AND ${DIVERGED_WHERE}`,
    );
    console.log(`교정 완료: ${updated}건 갱신`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
