import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import {
  listPaymentRequestsForExport, parsePaymentRequestEntity, parsePaymentRequestStatus, parsePaymentRequestDateParam,
} from "@/lib/data/payment-requests";
import { buildPaymentRequestExportXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급요청 목록 엑셀 다운로드. ids가 있으면 체크박스로 선택한 항목만(검색/필터 무시),
// 없으면 현재 검색/필터 결과 전체(페이지네이션 무시)를 내려받는다. ADMIN·SETTLEMENT 전용,
// 사업자번호·계좌번호는 마스킹이 아닌 원문으로 포함한다.
export async function GET(req: NextRequest) {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const sp = req.nextUrl.searchParams;
  const idsParam = sp.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];

  const rows = ids.length > 0
    ? await listPaymentRequestsForExport(ctx, undefined, ids)
    : await listPaymentRequestsForExport(ctx, {
      payDateFrom: parsePaymentRequestDateParam(sp.get("payDateFrom") ?? undefined),
      payDateTo: parsePaymentRequestDateParam(sp.get("payDateTo") ?? undefined),
      clientId: sp.get("clientId") || undefined,
      entity: parsePaymentRequestEntity(sp.get("entity") ?? undefined),
      status: parsePaymentRequestStatus(sp.get("status") ?? undefined),
      bizName: sp.get("bizName") || undefined,
    });

  const buf = await buildPaymentRequestExportXlsxBuffer(rows);

  const kstDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).replaceAll("-", "");
  const filename = encodeURIComponent(`지급요청리스트_${kstDate}.xlsx`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
