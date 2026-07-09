import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-[14px] bg-[var(--color-primary)] px-6 py-3 text-white"
        >
          @huno.kr 계정으로 로그인
        </button>
      </form>
    </main>
  );
}
