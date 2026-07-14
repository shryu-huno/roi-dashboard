// 개발용 더미 데이터 시드. 실행: `npm run seed` (또는 `node prisma/seed.js`).
// roi_app 역할은 RLS 대상이므로, withRLS와 동일하게 트랜잭션 안에서 GUC를 설정한 뒤 삽입한다.
// User 테이블은 RLS 미적용이라 트랜잭션 밖에서 upsert한다.
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

// .env 로드(간이). node는 .env를 자동 주입하지 않는다.
if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, "..", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const YEAR = 2026;

// 고객사·과업·월별 실적 데이터. 엑셀 5파트_고객사정리.xlsx에서 생성한다.
// 재생성: `python prisma/build-seed-data.py` (Sheet1=고객사/담당PM, Sheet2=과업/월별 실적).
const CLIENTS = require("./seed-data.json");

const NEW_USERS = [
  { email: "shryu@huno.kr", name: "류승환", role: "ADMIN" },
  { email: "sms@huno.kr", name: "심명섭", role: "ADMIN" },
  { email: "cocoball@huno.kr", name: "강규민", role: "PM" },
  { email: "tkfk0804@huno.kr", name: "이사라", role: "PM" },
  { email: "hjryu@huno.kr", name: "류현주", role: "PM" },
  { email: "lsj@huno.kr", name: "이승준", role: "PM" },
  { email: "oes@huno.kr", name: "오은숙", role: "SETTLEMENT" }  
];

async function main() {
  // 1) 임직원 upsert (RLS 미적용 → 트랜잭션 밖, 재실행 안전).
  //    이름 변경도 반영하도록 update에 name 포함.
  for (const u of NEW_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, status: "ACTIVE" },
      create: { email: u.email, name: u.name, role: u.role, status: "ACTIVE" },
    });
  }

  // NEW_USERS에 없는 기존 사용자는 삭제(목록을 임직원의 단일 소스로 취급).
  // User 삭제 시 ClientManager/Account/Session은 onDelete: Cascade로 함께 정리된다.
  const removed = await prisma.user.deleteMany({
    where: { email: { notIn: NEW_USERS.map((u) => u.email) } },
  });

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("ADMIN 사용자가 없습니다. 먼저 관리자 계정을 승인하세요.");

  // 담당PM 이름 → userId 매핑(엑셀의 담당PM 이름을 사용자와 문자열 매칭; 동명이인 없음 전제).
  const allUsers = await prisma.user.findMany({ select: { id: true, name: true } });
  const userIdByName = new Map(allUsers.map((u) => [u.name, u.id]));

  // 2) 고객사·과업·월별 실적 (RLS 대상 → ADMIN 컨텍스트 트랜잭션).
  const summary = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${admin.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_role', 'ADMIN', true)`;

      // 모든 고객사 삭제 후 엑셀 데이터로 재적재(cascade로 과업/실적/지출/청구/입금/담당 정리).
      await tx.client.deleteMany({});

      let taskTotal = 0, perfTotal = 0, unassigned = 0;

      for (const c of CLIENTS) {
        // 담당PM 이름이 사용자와 매칭되면 배정, 아니면 미배정.
        const userId = c.pm ? userIdByName.get(c.pm) : undefined;
        if (!userId) unassigned++;
        const client = await tx.client.create({
          data: {
            name: c.name,
            status: "진행중",
            industry: null,
            businessType: c.businessType || null,
            contractStart: c.contractStart ? new Date(c.contractStart) : null,
            contractEnd: c.contractEnd ? new Date(c.contractEnd) : null,
            billingCycle: c.billingCycle || [],
            reportCycle: c.reportCycle || [],
            managers: userId ? { create: [{ userId }] } : undefined,
          },
        });

        for (const t of c.tasks) {
          const task = await tx.task.create({
            data: {
              clientId: client.id,
              name: t.name,
              unitPrice: t.unitPrice,
              contractCount: t.contractCount,
              contractAmount: t.contractAmount,
            },
          });
          taskTotal++;

          for (const p of t.performances) {
            await tx.monthlyPerformance.create({
              data: { taskId: task.id, year: YEAR, month: p.month, count: p.count, amount: p.amount },
            });
            perfTotal++;
          }
        }
      }

      return { clients: CLIENTS.length, taskTotal, perfTotal, unassigned };
    },
    { timeout: 120000, maxWait: 20000 },
  );

  console.log("시드 완료:");
  console.log(`  임직원 추가/갱신: ${NEW_USERS.length}명, 삭제: ${removed.count}명`);
  console.log(`  고객사: ${summary.clients}개 (담당 미배정: ${summary.unassigned}개)`);
  console.log(`  과업: ${summary.taskTotal}개, 실적행: ${summary.perfTotal}개`);
  console.log(`  연도: ${YEAR}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
