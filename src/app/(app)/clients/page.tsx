import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { ClientsList } from "@/components/clients/ClientsList";

export default async function ClientsPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const clients = await listClients(ctx);

  return <ClientsList clients={clients} />;
}
