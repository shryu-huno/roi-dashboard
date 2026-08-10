// Payee.accountNumberBidx 백필 스크립트.
// 실행 순서: 20260805010000 마이그레이션(nullable 컬럼 추가) 적용 →
//           이 스크립트 실행 → 20260805020000 마이그레이션(NOT NULL 확정) 적용.
// 실행: npx tsx scripts/backfill-payee-account-bidx.ts
// RLS 우회 없이(BYPASSRLS/슈퍼유저 없이) 정상 동작하도록 withRLS(ADMIN)로 감싼다 —
// 앱의 실제 런타임 role(roi_app)은 슈퍼유저가 아니라 FORCE ROW LEVEL SECURITY에
// 걸리므로, 세션 컨텍스트 없이 update()를 직접 호출하면 0건 매치로 조용히 실패한다.
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env.local"), override: true });

async function main() {
  const { withRLS } = await import("../src/lib/rls");
  const { decrypt, digitsOnly, blindIndex } = await import("../src/lib/crypto/payee-secret");
  const { prisma } = await import("../src/lib/db");

  const ADMIN = { userId: "backfill-script", role: "ADMIN" as const };

  // 소프트 삭제 행도 포함 — NOT NULL 제약을 걸기 전에 테이블 전체가 백필돼야 한다.
  const updated = await withRLS(ADMIN, async (tx) => {
    const payees = await tx.payee.findMany({ select: { id: true, accountNumberEnc: true } });
    let count = 0;
    for (const p of payees) {
      const digits = digitsOnly(decrypt(p.accountNumberEnc));
      await tx.payee.update({ where: { id: p.id }, data: { accountNumberBidx: blindIndex(digits) } });
      count++;
    }
    return count;
  });

  console.log(`백필 완료: ${updated}건`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
