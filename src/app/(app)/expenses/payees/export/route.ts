import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { listPayeesForExport, parsePayeeSearchField } from "@/lib/data/payees";
import { buildExportXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급 리스트 엑셀 다운로드(현재 검색/필터 결과 그대로). ADMIN·SETTLEMENT 전용,
// 사업자번호는 마스킹이 아닌 원문으로 포함한다.
export async function GET(req: NextRequest) {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const field = parsePayeeSearchField(req.nextUrl.searchParams.get("field") ?? undefined);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const filter = field && q.trim() ? { field, q } : undefined;

  const rows = await listPayeesForExport(ctx, filter);
  const buf = await buildExportXlsxBuffer(rows);

  const kstDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).replaceAll("-", "");
  const filename = encodeURIComponent(`지급리스트_${kstDate}.xlsx`);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
