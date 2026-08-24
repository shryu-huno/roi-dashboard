-- 과업 면세 여부. 기본 과세(false). 면세 과업은 부가세 토글이 켜져도 계약금·실적에 ×1.1을 적용하지 않는다.
ALTER TABLE "Task" ADD COLUMN "vatExempt" BOOLEAN NOT NULL DEFAULT false;
