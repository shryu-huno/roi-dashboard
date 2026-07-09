import { requireUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar role={user.role} />
      <div className="flex flex-1 flex-col">
        <Topbar email={user.email ?? ""} role={user.role} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
