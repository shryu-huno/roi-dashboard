import { redirect } from "next/navigation";

// 팀 관리는 "유저 관리"(/admin/users) 한 화면으로 통합되었다. 기존 북마크 보호를 위해 리다이렉트한다.
// 팀·파트 CRUD 액션(./actions.ts)은 통합 화면이 계속 재사용한다.
export default function AdminTeamsPage() {
  redirect("/admin/users");
}
