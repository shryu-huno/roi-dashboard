import { requireUser } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { parsePeriodParams } from "@/lib/period";
import { getClientDetail } from "@/lib/data/metrics";
import { getIncludeVat } from "@/lib/vat";
import { csvFromRows } from "@/lib/csv";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = getRlsContext(user);
  const url = new URL(req.url);
  const { year, period } = parsePeriodParams(
    { year: url.searchParams.get("year") ?? undefined, period: url.searchParams.get("period") ?? undefined },
    new Date().getFullYear(),
  );

  const includeVat = await getIncludeVat();
  const detail = await getClientDetail(ctx, id, year, period, includeVat);
  if (!detail) return new Response("Not found", { status: 404 });

  const rows: string[][] = [
    ["월", "실적", "청구", "입금", "지출"],
    ...detail.monthly.map((m) => [
      String(m.month), String(m.performance), String(m.billing), String(m.deposit), String(m.expense),
    ]),
  ];
  const csv = "﻿" + csvFromRows(rows); // Excel 한글 호환 BOM
  const filename = encodeURIComponent(`${detail.client.name}_${year}_${period}.csv`);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
