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

// 결정적 PRNG (재실행 시 동일 데이터).
let _s = 20260710;
const rnd = () => {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
};
const ri = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const round1000 = (v) => Math.round(v / 1000) * 1000;

const NEW_USERS = [
  { email: "park.sj@huno.kr", name: "박서준", role: "PM" },
  { email: "choi.yn@huno.kr", name: "최유나", role: "PM" },
  { email: "jung.dh@huno.kr", name: "정도현", role: "PM" },
  { email: "oh.sh@huno.kr", name: "오세훈", role: "PM" },
  { email: "han.jw@huno.kr", name: "한지우", role: "SETTLEMENT" },
];

const CLIENT_NAMES = [
  "가온컨설팅", "나래교육", "다온헬스케어", "라온물류", "마루테크", "바다건설",
  "사랑복지재단", "아름드리유통", "자연지혜", "차오름에듀", "카린화장품", "타임교육원",
];

const TASK_TEMPLATES = [
  { name: "심리검사 진단", unitPrice: 50000, contractCount: 40 },
  { name: "집단상담 프로그램", unitPrice: 300000, contractCount: 12 },
  { name: "개인상담 세션", unitPrice: 80000, contractCount: 30 },
  { name: "관리자 리더십 교육", unitPrice: 500000, contractCount: 6 },
  { name: "직무 스트레스 검사", unitPrice: 30000, contractCount: 100 },
  { name: "찾아가는 상담", unitPrice: 150000, contractCount: 20 },
  { name: "힐링 워크숍", unitPrice: 700000, contractCount: 4 },
  { name: "1:1 코칭", unitPrice: 120000, contractCount: 15 },
  { name: "온라인 강의 콘텐츠", unitPrice: 250000, contractCount: 8 },
  { name: "조직 진단 컨설팅", unitPrice: 1000000, contractCount: 3 },
];

const EXPENSE_CATS = [
  "LABOR_COUNSELOR", "OPS_TRANSPORT", "OPS_FOOD", "EDUCATION_PROGRAM",
  "TEST_MATERIAL", "PROMOTION_OFFLINE", "OPS_LODGING", "GENERAL_ETC",
];

async function main() {
  // 1) 임직원 5명 (RLS 미적용 → 트랜잭션 밖 upsert, 재실행 안전).
  for (const u of NEW_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, status: "ACTIVE" },
      create: { email: u.email, name: u.name, role: u.role, status: "ACTIVE" },
    });
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("ADMIN 사용자가 없습니다. 먼저 관리자 계정을 승인하세요.");
  const pms = await prisma.user.findMany({ where: { role: "PM", status: "ACTIVE" }, orderBy: { email: "asc" } });
  if (pms.length === 0) throw new Error("배정할 PM이 없습니다.");

  // 2) 고객사·과업·실적·지출·청구/입금 (RLS 대상 → ADMIN 컨텍스트 트랜잭션).
  const summary = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${admin.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_role', 'ADMIN', true)`;

      // 재실행 idempotent: 시드 고객사만 삭제(cascade). 수동 입력 고객사는 보존.
      await tx.client.deleteMany({ where: { name: { in: CLIENT_NAMES } } });

      let taskTotal = 0, perfTotal = 0, expenseTotal = 0, billingTotal = 0;

      for (let i = 0; i < CLIENT_NAMES.length; i++) {
        // 마지막 고객사는 PM 미배정(대시보드 "미배정" 행 검증용).
        const pmId = i === CLIENT_NAMES.length - 1 ? null : pms[i % pms.length].id;
        const client = await tx.client.create({
          data: {
            name: CLIENT_NAMES[i],
            status: "진행중",
            pmId,
            contractStart: new Date(Date.UTC(YEAR, 0, 1)),
            contractEnd: new Date(Date.UTC(YEAR, 11, 31)),
          },
        });

        // 과업 2~4개(고객사마다 다양).
        const taskCount = 2 + (i % 3);
        const chosen = Array.from({ length: taskCount }, (_, k) => TASK_TEMPLATES[(i + k) % TASK_TEMPLATES.length]);
        const monthlyClientPerf = {}; // month -> 실적 합

        for (const tpl of chosen) {
          const task = await tx.task.create({
            data: {
              clientId: client.id,
              name: tpl.name,
              unitPrice: tpl.unitPrice,
              contractCount: tpl.contractCount,
              contractAmount: tpl.unitPrice * tpl.contractCount, // 단가×횟수 (deriveContractAmount와 동일)
            },
          });
          taskTotal++;

          // 활성 개월 수 6~9개월, 무작위 월에 실적.
          const activeMonths = ri(6, 9);
          const months = new Set();
          while (months.size < activeMonths) months.add(ri(1, 12));
          const maxPerMonth = Math.max(2, Math.round(tpl.contractCount / 8));
          for (const month of months) {
            const count = ri(1, maxPerMonth);
            const amount = tpl.unitPrice * count;
            await tx.monthlyPerformance.create({
              data: { taskId: task.id, year: YEAR, month, count, amount },
            });
            perfTotal++;
            monthlyClientPerf[month] = (monthlyClientPerf[month] ?? 0) + amount;
          }
        }

        // 지출: 4개 분류 × 3개월.
        const cats = Array.from({ length: 4 }, (_, k) => EXPENSE_CATS[(i + k) % EXPENSE_CATS.length]);
        const expMonths = [ri(1, 4), ri(5, 8), ri(9, 12)];
        for (const month of expMonths) {
          for (const category of cats) {
            const amount = round1000(ri(50000, 800000));
            await tx.expense.upsert({
              where: { clientId_year_month_category: { clientId: client.id, year: YEAR, month, category } },
              update: { amount },
              create: { clientId: client.id, year: YEAR, month, category, amount },
            });
            expenseTotal++;
          }
        }

        // 청구/입금: 실적이 있는 달마다. 일부 달은 입금<청구(미수금 강조 검증용).
        let idx = 0;
        for (const [monthStr, perf] of Object.entries(monthlyClientPerf)) {
          const month = Number(monthStr);
          const billing = round1000(perf * (0.9 + rnd() * 0.2));
          const deposit = idx % 3 === 0 ? round1000(billing * 0.6) : billing; // 1/3은 미수금
          await tx.monthlyBilling.upsert({
            where: { clientId_year_month: { clientId: client.id, year: YEAR, month } },
            update: { amount: billing },
            create: { clientId: client.id, year: YEAR, month, amount: billing },
          });
          await tx.monthlyDeposit.upsert({
            where: { clientId_year_month: { clientId: client.id, year: YEAR, month } },
            update: { amount: deposit },
            create: { clientId: client.id, year: YEAR, month, amount: deposit },
          });
          billingTotal++;
          idx++;
        }
      }

      return { clients: CLIENT_NAMES.length, taskTotal, perfTotal, expenseTotal, billingTotal };
    },
    { timeout: 120000, maxWait: 20000 },
  );

  console.log("시드 완료:");
  console.log(`  임직원 추가/갱신: ${NEW_USERS.length}명`);
  console.log(`  고객사: ${summary.clients}개 (마지막 1개는 PM 미배정)`);
  console.log(`  과업: ${summary.taskTotal}개, 실적행: ${summary.perfTotal}개`);
  console.log(`  지출행: ${summary.expenseTotal}개, 청구·입금 달: ${summary.billingTotal}개`);
  console.log(`  연도: ${YEAR}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
