import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listClients } from "@/lib/data/clients";
import { listInvoices } from "@/lib/data/invoices";
import { InvoiceForm } from "./InvoiceForm";
import { InvoiceList } from "./InvoiceList";

export default async function BillingPage() {
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const [clients, invoices] = await Promise.all([listClients(ctx), listInvoices(ctx)]);
  // 콤보박스는 배정된(RLS 통과) 고객사만 노출한다.
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">청구 입력</h1>
      <InvoiceForm clients={clientOptions} />
      <InvoiceList rows={invoices} clients={clientOptions} />
    </div>
  );
}
