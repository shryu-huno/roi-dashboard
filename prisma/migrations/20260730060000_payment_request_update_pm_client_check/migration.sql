-- payment_request_update_pm의 WITH CHECK가 requesterId만 검사해, PM이 본인이 신청한 건의
-- clientId를 담당하지 않는 고객사로 바꿔치기(UPDATE)할 수 있었다. INSERT 정책(payment_request_insert_pm)과
-- 동일하게 ClientManager 담당 여부를 WITH CHECK에 추가한다. USING은 그대로 둔다 — 어떤 기존 행을
-- 수정 대상으로 삼을 수 있는지는 requesterId만으로 충분하고(PM은 담당이 바뀌어도 자신이 신청한 건을
-- 수정할 수 있어야 함), 수정 후 결과가 유효한지(clientId가 여전히 담당 고객사인지)는 WITH CHECK가 막는다.
DROP POLICY payment_request_update_pm ON "PaymentRequest";
CREATE POLICY payment_request_update_pm ON "PaymentRequest"
  FOR UPDATE
  USING (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) = 'PM'
    AND "requesterId" = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1 FROM "ClientManager" cm
      WHERE cm."clientId" = "PaymentRequest"."clientId"
        AND cm."userId" = current_setting('app.user_id', true)
    )
  );
