import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RlsContext = {
  userId: string;
  role: "ADMIN" | "SETTLEMENT" | "PM";
};

/**
 * 요청별 사용자 컨텍스트를 주입한 트랜잭션.
 * set_config(..., true) = SET LOCAL → 트랜잭션 종료 시 자동 초기화되어
 * 커넥션 풀 재사용 시 컨텍스트가 누출되지 않는다.
 */
export function withRLS<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.user_role', ${ctx.role}, true)`;
    return fn(tx);
  });
}
