import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  await requireUser(); // 미인증/미승인은 여기서 리다이렉트
  redirect("/clients");
}
