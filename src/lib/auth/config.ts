import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { isAllowedEmail } from "@/lib/auth/domain";
import type { AppRole } from "@/lib/auth/rbac";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "huno.kr";

export async function signInCallback(params: {
  user: { email?: string | null };
}): Promise<boolean> {
  // 서버 측 도메인 재검증 (OAuth hd 힌트는 신뢰하지 않음)
  return isAllowedEmail(params.user.email, ALLOWED_DOMAIN);
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // 비표준 Next.js 16.x에서 Vercel 호스트 자동 감지가 되지 않아 명시적으로 신뢰 처리
  // (프록시 뒤의 x-forwarded-host를 신뢰해 콜백 URL을 올바르게 구성)
  trustHost: true,
  session: { strategy: "database" },
  providers: [
    Google({
      authorization: {
        params: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    signIn: signInCallback,
    async session({ session, user }) {
      // 어댑터의 DB user에서 role/status를 세션에 부착
      session.user.id = user.id;
      session.user.role = (user as unknown as { role: AppRole | null }).role ?? null;
      session.user.status = (user as unknown as { status: "PENDING" | "ACTIVE" | "INACTIVE" }).status;
      return session;
    },
  },
};
