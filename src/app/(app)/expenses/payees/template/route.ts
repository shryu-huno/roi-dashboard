import { requireRole } from "@/lib/auth/session";
import { buildTemplateXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// 지급 리스트 등록용 빈 서식(.xlsx, 헤더만) 다운로드. ADMIN·SETTLEMENT 전용.
export async function GET() {
  await requireRole("SETTLEMENT");
  const buf = await buildTemplateXlsxBuffer();
  const filename = encodeURIComponent("지급리스트_양식.xlsx");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
