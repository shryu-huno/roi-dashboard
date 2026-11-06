-- 입찰 금액을 64비트 정수로 넓힌다. 32비트(약 21억 4748만원)로는 큰 입찰을 등록할 수 없다.
-- 앱은 숫자(Number)로 다루며 입력은 자바스크립트가 정확히 표현하는 범위(약 9천조) 안으로 제한한다.
ALTER TABLE "Bid" ALTER COLUMN "amount" TYPE BIGINT;
