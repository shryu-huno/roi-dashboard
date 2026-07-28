// 상담료 지출내역 엑셀 → ConsultingExpense 적재.
// 저장 컬럼: 상담분야(field) / 고객사명(clientName=Client.name) + clientId(엑셀 기업명 정규화 매칭) / 지급비용(amount, 빈칸=0)
//           / 지급월(year·month) / 상담유형(consultType, 참고용)
// 실행: node scripts/import-consulting-expense.mjs "<xlsx 경로>"
// 대상 DB는 로드된 .env의 DATABASE_URL을 따른다(로컬=.env / 프로덕션=.env.production 주입).
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaClient, Prisma } from '@prisma/client';

const XLSX = process.argv[2] ?? '#상담료 지출내역(상반기)_test.xlsx';
const SHEET = 'Employee_2026-07-20 (1)';
const prisma = new PrismaClient();
const norm = (s) => String(s ?? '').replace(/\s+/g, '');
const cell = (row, c) => {
  let v = row.getCell(c).value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v && typeof v === 'object' && 'text' in v) v = v.text;
  return v;
};

// 1) 엑셀 파싱
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.getWorksheet(SHEET);
if (!ws) throw new Error(`시트를 찾을 수 없음: ${SHEET}`);

const rows = [];
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const field = cell(row, 1);
  const company = cell(row, 4);
  const type = cell(row, 5);
  const costRaw = cell(row, 6);
  const payMonth = cell(row, 7);
  if (field == null && company == null) continue; // 빈 행 스킵

  const costNum = typeof costRaw === 'number'
    ? costRaw
    : Number(String(costRaw ?? '').replace(/,/g, ''));
  const amount = Number.isFinite(costNum) ? Math.round(costNum) : 0; // 빈칸/비숫자 → 0

  if (!(payMonth instanceof Date)) throw new Error(`행 ${r}: 지급월이 날짜가 아님(${payMonth})`);
  const year = payMonth.getFullYear();
  const month = payMonth.getMonth() + 1;

  rows.push({
    field: String(field),
    excelCompany: String(company), // 매칭용 엑셀 원문(저장하지 않음)
    consultType: type == null ? null : String(type),
    amount, year, month,
  });
}
console.log(`엑셀 데이터 행: ${rows.length}`);

// 2) Client 매핑 (ADMIN 컨텍스트로 RLS 우회). 엑셀 기업명(공백 정규화)으로 매칭하고,
//    저장은 정식 고객사명(Client.name)으로 한다.
const clients = await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.user_role','ADMIN',true), set_config('app.user_id','import',true)`;
  return tx.$queryRaw`SELECT id, name FROM "Client" WHERE "deletedAt" IS NULL`;
});
const byNorm = new Map(clients.map((c) => [norm(c.name), c]));

const unmatched = new Map();
for (const row of rows) {
  const client = byNorm.get(norm(row.excelCompany));
  if (!client) { unmatched.set(row.excelCompany, (unmatched.get(row.excelCompany) ?? 0) + 1); continue; }
  row.clientId = client.id;
  row.clientName = client.name; // 정식 고객사명
}
if (unmatched.size) {
  console.error('✗ Client 미매칭 기업명 발견 — 적재 중단:');
  for (const [k, v] of unmatched) console.error(`   ${k}: ${v}행`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`고객사명 매핑 완료: 전 행 clientId 연결 (고객사 ${new Set(rows.map(r=>r.clientId)).size}개사)`);

// 3) 적재 (기존 전량 삭제 후 재적재 = 멱등). ADMIN 컨텍스트 트랜잭션.
const now = new Date();
const inserted = await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.user_role','ADMIN',true), set_config('app.user_id','import',true)`;
  const del = await tx.$executeRaw`DELETE FROM "ConsultingExpense"`;
  console.log(`기존 행 삭제: ${del}`);
  let count = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const tuples = slice.map((r) => Prisma.sql`(${crypto.randomUUID()}, ${r.clientId}, ${r.clientName}, ${r.field}, ${r.consultType}, ${r.year}, ${r.month}, ${r.amount}, ${now})`);
    count += await tx.$executeRaw`
      INSERT INTO "ConsultingExpense" ("id","clientId","clientName","field","consultType","year","month","amount","updatedAt")
      VALUES ${Prisma.join(tuples)}`;
  }
  return count;
}, { timeout: 120000, maxWait: 15000 });

console.log(`✓ 적재 완료: ${inserted}행`);
await prisma.$disconnect();
