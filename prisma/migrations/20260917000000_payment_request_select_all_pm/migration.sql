-- PM이 담당 고객사와 무관하게 지급요청 전체를 조회할 수 있도록 SELECT 정책을 완화한다.
-- 수정/삭제(payment_request_update_pm)는 여전히 본인이 신청한 건 + 담당 고객사로 제한되어 그대로 둔다.
DROP POLICY payment_request_select ON "PaymentRequest";
CREATE POLICY payment_request_select ON "PaymentRequest"
  FOR SELECT
  USING (current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT', 'PM'));
