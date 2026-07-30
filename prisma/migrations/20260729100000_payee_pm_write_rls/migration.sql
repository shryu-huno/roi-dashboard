-- PM은 지급 리스트 등록(INSERT)과 부분수정/소프트삭제(UPDATE)가 가능해야 하지만
-- 실제 SQL DELETE는 여전히 ADMIN/SETTLEMENT 전용이다(소프트 삭제는 deletedAt을 세팅하는
-- UPDATE라 별도 DELETE 권한이 필요 없음). 기존 payee_write/payee_attachment_write(ADMIN/
-- SETTLEMENT, FOR ALL)는 그대로 두고 PM 전용 정책을 추가한다 — 여러 permissive 정책은 OR로 합쳐진다.
CREATE POLICY payee_write_pm ON "Payee"
  FOR INSERT
  WITH CHECK (current_setting('app.user_role', true) = 'PM');
CREATE POLICY payee_update_pm ON "Payee"
  FOR UPDATE
  USING (current_setting('app.user_role', true) = 'PM')
  WITH CHECK (current_setting('app.user_role', true) = 'PM');

-- 첨부파일도 동일: PM은 업로드/교체(Prisma upsert = INSERT 또는 UPDATE)만 가능, 삭제는 불가.
CREATE POLICY payee_attachment_write_pm ON "PayeeAttachment"
  FOR INSERT
  WITH CHECK (current_setting('app.user_role', true) = 'PM');
CREATE POLICY payee_attachment_update_pm ON "PayeeAttachment"
  FOR UPDATE
  USING (current_setting('app.user_role', true) = 'PM')
  WITH CHECK (current_setting('app.user_role', true) = 'PM');
