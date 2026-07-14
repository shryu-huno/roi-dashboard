// xlsx에서 추출한 사업자구분·계약기간·청구·보고 주기를 기존 Client 레코드에 업데이트.
// 고객사 삭제 없이 name 매칭으로 해당 필드만 덮어씀(ID·과업·비용 등 보존).
// 실행: node prisma/update-client-meta.js
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

if (!process.env.DATABASE_URL) {
  const envPath = path.join(__dirname, "..", ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const CLIENTS = require("./seed-data.json");

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("ADMIN 사용자가 없습니다.");

  let updated = 0, skipped = 0;

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${admin.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_role', 'ADMIN', true)`;

      for (const c of CLIENTS) {
        const result = await tx.client.updateMany({
          where: { name: c.name },
          data: {
            businessType: c.businessType ?? null,
            contractStart: c.contractStart ? new Date(c.contractStart) : null,
            contractEnd: c.contractEnd ? new Date(c.contractEnd) : null,
            billingCycle: c.billingCycle ?? [],
            reportCycle: c.reportCycle ?? [],
          },
        });
        if (result.count > 0) updated++;
        else { skipped++; console.log(`  미매칭(DB에 없음): ${c.name}`); }
      }
    },
    { timeout: 30000 },
  );

  console.log(`완료: ${updated}개 업데이트, ${skipped}개 미매칭`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
