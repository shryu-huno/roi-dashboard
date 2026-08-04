import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import { getPayeeAttachments } from "@/lib/data/payee-attachments";
import { downloadPayeeFile, StorageConfigError } from "@/lib/storage/payee-attachments";

export const runtime = "nodejs";

// 첨부파일(사업자등록증/통장사본) 다운로드. ADMIN·SETTLEMENT 전용.
// 파일명은 upsertPayeeAttachment 저장 시 이미 "고유번호_업체명_구분" 형태로 고정돼 있으므로
// 그대로 Content-Disposition에 실어 내려준다(Supabase 서명 URL의 download 옵션은 비ASCII
// 파일명을 이중 인코딩해 깨뜨리는 문제가 있어 쓰지 않는다 — payee-attachments.ts 참고).
export async function GET(req: NextRequest) {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const payeeId = req.nextUrl.searchParams.get("payeeId");
  const fileType = req.nextUrl.searchParams.get("fileType");
  if (!payeeId || (fileType !== "BIZ_CERT" && fileType !== "BANKBOOK")) {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }

  const pair = await getPayeeAttachments(ctx, payeeId);
  const record = fileType === "BIZ_CERT" ? pair.bizCert : pair.bankbook;
  if (!record) return new Response("파일을 찾을 수 없습니다.", { status: 404 });

  try {
    const blob = await downloadPayeeFile(record.fileUrl);
    const filename = encodeURIComponent(record.fileName);
    return new Response(blob, {
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      },
    });
  } catch (e) {
    if (e instanceof StorageConfigError) {
      console.error("[attachment download] Storage 설정 오류:", e.message);
      return new Response("서버 설정(파일 저장소)이 누락되었습니다. 관리자에게 문의하세요.", { status: 500 });
    }
    console.error("[attachment download] 다운로드 실패:", e);
    return new Response("다운로드에 실패했습니다.", { status: 500 });
  }
}
