import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RlsContext = {
  userId: string;
  role: "SUPER_ADMIN" | "ADMIN" | "SETTLEMENT" | "PM";
  // 팀 관리자의 접근 범위 기준. 미지정(전체 접근 역할·테스트)은 생략 가능 → 빈 문자열로 주입된다.
  teamId?: string | null;
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
    // set_config 값은 text만 허용 → teamId null은 빈 문자열로. 정책의 nullif(..,'')가 무력화한다.
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true), set_config('app.user_role', ${ctx.role}, true), set_config('app.team_id', ${ctx.teamId ?? ""}, true)`;
    return fn(tx);
  });
}
