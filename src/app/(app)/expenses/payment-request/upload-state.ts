import type { ActionState } from "@/lib/action-state";

// 업로드 결과 상태(모달의 useActionState용). "use server" 파일(actions.ts)은 함수만 export할 수
// 있어 상수/타입은 여기 일반 모듈에 둔다.
export type PaymentRequestUploadState = ActionState & {
  updated?: number;
  rowErrors?: { row: number; message: string }[];
};

export const PAYMENT_REQUEST_UPLOAD_INIT: PaymentRequestUploadState = { ok: true };
