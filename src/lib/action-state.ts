export type ActionState = { ok: boolean; error?: string; message?: string };
// 폼 초기 상태(아직 저장 안 함) — message 없음.
export const OK: ActionState = { ok: true };
// 저장 성공 후 상태 — 화면에 "저장되었습니다" 안내를 띄우기 위한 message 포함.
export const SAVED: ActionState = { ok: true, message: "저장되었습니다." };
