import { requireRole } from "@/lib/auth/session";
import { buildPaymentRequestRegistrationTemplateXlsxBuffer } from "../xlsx";

export const runtime = "nodejs";

// PM 엑셀 대량 등록용 빈 서식(.xlsx) 다운로드. 헤더만 있고 PII가 없어 등록 권한(PM)과 동일하게 연다.
export async function GET() {
  await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과.
  const buf = await buildPaymentRequestRegistrationTemplateXlsxBuffer();
  const filename = encodeURIComponent("지급요청_등록양식.xlsx");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
