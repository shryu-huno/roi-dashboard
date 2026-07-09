-- Expense 데이터가 없는 상태에서 ExpenseCategory enum을 교체한다.
-- PostgreSQL은 enum 값 삭제를 지원하지 않으므로 새 타입을 만들고 교체.

CREATE TYPE "ExpenseCategory_new" AS ENUM (
  'CORPORATE_CARD',
  'PERSONAL_CARD',
  'LABOR_COUNSELOR',
  'LABOR_INSTRUCTOR',
  'EDUCATION_PROGRAM',
  'PROMOTION_OFFLINE',
  'PROMOTION_EVENT',
  'OPS_TRANSPORT',
  'OPS_LODGING',
  'OPS_FOOD',
  'OPS_MEETING',
  'TEST_MATERIAL',
  'GENERAL_ETC'
);

ALTER TABLE "Expense"
  ALTER COLUMN "category" TYPE "ExpenseCategory_new"
  USING ("category"::text::"ExpenseCategory_new");

DROP TYPE "ExpenseCategory";

ALTER TYPE "ExpenseCategory_new" RENAME TO "ExpenseCategory";
