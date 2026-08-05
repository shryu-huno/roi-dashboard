import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listPayeeOptions } from "@/lib/data/payees";
import { PaymentRequestNewForm } from "../../PaymentRequestNewForm";

export default async function NewPaymentRequestPage() {
  const user = await requireUser();
  if (!user.role || user.role !== "PM") redirect("/expenses?tab=payment-request");
  const ctx = getRlsContext(user);
  const [clients, payees] = await Promise.all([listClients(ctx), listPayeeOptions(ctx)]);

  return (
    <div>
      <PaymentRequestNewForm
        clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
        payees={payees}
      />
    </div>
  );
}
