import type { AppRole } from "@/lib/auth/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole | null;
      status: "PENDING" | "ACTIVE" | "INACTIVE";
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
