import type { ActionState } from "@/lib/action-state";

export type PayeeAttachmentSaveState = ActionState & {
  bizCertError?: string;
  bankbookError?: string;
};

export const PAYEE_ATTACHMENT_SAVE_INIT: PayeeAttachmentSaveState = { ok: true };
