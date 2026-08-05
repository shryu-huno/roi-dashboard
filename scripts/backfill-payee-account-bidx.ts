// Payee.accountNumberBidx 백필 스크립트.
// 실행 순서: 20260805010000 마이그레이션(nullable 컬럼 추가) 적용 →
//           이 스크립트 실행 → 20260805020000 마이그레이션(NOT NULL 확정) 적용.
// 실행: npx tsx scripts/backfill-payee-account-bidx.ts
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env.local"), override: true });

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { decrypt, digitsOnly, blindIndex } = await import("../src/lib/crypto/payee-secret");

  // 소프트 삭제 행도 포함 — NOT NULL 제약을 걸기 전에 테이블 전체가 백필돼야 한다.
  const payees = await prisma.payee.findMany({ select: { id: true, accountNumberEnc: true } });

  let updated = 0;
  for (const p of payees) {
    const digits = digitsOnly(decrypt(p.accountNumberEnc));
    await prisma.payee.update({ where: { id: p.id }, data: { accountNumberBidx: blindIndex(digits) } });
    updated++;
  }
  console.log(`백필 완료: ${updated}건`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
