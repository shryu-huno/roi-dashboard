// 법인카드 사용 내역 엑셀 → CorporateCardExpense 적재.
// 저장 컬럼: 항목(item) / 고객사명(clientName=Client.name) + clientId(엑셀 프로젝트명 정규화 매칭)
//           / 이용일 기준 지출월(year·month) / 매입금액=지출금액(amount).
// 시트가 여러 개(1월~6월)여도 전 시트를 순회한다. 열은 헤더명(공백 정규화)으로 찾는다.
// SUPABASE(Client)에 있는 고객사명만 적재하고, 미매칭 프로젝트명은 건너뛴다(중단하지 않음).
// 실행: node scripts/import-corporate-card.mjs "<xlsx 경로>"
// 대상 DB는 로드된 .env의 DATABASE_URL을 따른다(로컬=.env / 프로덕션=.env.production 주입).
import crypto from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaClient, Prisma } from '@prisma/client';

const XLSX = process.argv[2] ?? '법인카드 사용 내역_상반기_test.xlsx';
const prisma = new PrismaClient();
const norm = (s) => String(s ?? '').replace(/\s+/g, '');
const cellVal = (c) => {
  let v = c.value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (v && typeof v === 'object' && 'text' in v) v = v.text;
  return v;
};
// 이용일 → {year, month}. 문자열("2026.01.02")·Date·엑셀 날짜 모두 처리.
function parseYm(v) {
  if (v instanceof Date) return { year: v.getFullYear(), month: v.getMonth() + 1 };
  const m = String(v ?? '').match(/(\d{4})\D+(\d{1,2})/);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

// 1) 엑셀 파싱 — 전 시트 순회, 헤더명(공백 정규화)으로 열 위치를 찾는다.
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);

const rows = [];
for (const ws of wb.worksheets) {
  const header = ws.getRow(1);
  const colOf = {};
  for (let c = 1; c <= ws.columnCount; c++) colOf[norm(cellVal(header.getCell(c)))] = c;
  const need = (...names) => {
    for (const n of names) if (colOf[norm(n)]) return colOf[norm(n)];
    throw new Error(`[${ws.name}] 필요한 열을 찾을 수 없음: ${names.join(' / ')}`);
  };
  const cDate = need('이용일');
  const cAmount = need('매입금액');
  const cCompany = need('프로젝트명(고객사)', '프로젝트명', '고객사명');
  const cItem = need('항목');

  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return; // 헤더
    const dateRaw = cellVal(row.getCell(cDate));
    const amountRaw = cellVal(row.getCell(cAmount));
    const company = cellVal(row.getCell(cCompany));
    const item = cellVal(row.getCell(cItem));
    if (company == null && amountRaw == null && dateRaw == null) return; // 빈 행

    const ym = parseYm(dateRaw);
    if (!ym) throw new Error(`[${ws.name}] 행 ${rn}: 이용일이 날짜가 아님(${dateRaw})`);
    const amtNum = typeof amountRaw === 'number' ? amountRaw : Number(String(amountRaw ?? '').replace(/,/g, ''));
    const amount = Number.isFinite(amtNum) ? Math.round(amtNum) : 0;

    rows.push({
      excelCompany: String(company ?? ''), // 매칭용 엑셀 프로젝트명(저장은 정식 고객사명으로)
      item: String(item ?? '').trim() || '(미분류)',
      year: ym.year,
      month: ym.month,
      amount,
    });
  });
}
console.log(`엑셀 데이터 행: ${rows.length} (시트 ${wb.worksheets.length}개)`);

// 2) Client 매핑 (ADMIN 컨텍스트로 RLS 우회). 고객사명(공백 정규화)으로 매칭.
//    SUPABASE(Client)에 없는 프로젝트명은 건너뛴다(요구사항: 있는 고객사명만 적재).
const clients = await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.user_role','ADMIN',true), set_config('app.user_id','import',true)`;
  return tx.$queryRaw`SELECT id, name FROM "Client" WHERE "deletedAt" IS NULL`;
});
const byNorm = new Map(clients.map((c) => [norm(c.name), c]));

const matched = [];
const skipped = new Map();
for (const row of rows) {
  const client = byNorm.get(norm(row.excelCompany));
  if (!client) { skipped.set(row.excelCompany, (skipped.get(row.excelCompany) ?? 0) + 1); continue; }
  matched.push({ ...row, clientId: client.id, clientName: client.name });
}
console.log(`매칭 완료: 적재 대상 ${matched.length}행 (고객사 ${new Set(matched.map(r=>r.clientId)).size}개사)`);
if (skipped.size) {
  const totalSkipped = [...skipped.values()].reduce((s, n) => s + n, 0);
  console.log(`건너뜀(SUPABASE 미등록 고객사) ${skipped.size}개 프로젝트명, ${totalSkipped}행:`);
  for (const [k, v] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`   ✗ ${k}: ${v}행`);
}

// 3) 적재 (기존 전량 삭제 후 재적재 = 멱등). ADMIN 컨텍스트 트랜잭션.
const now = new Date();
const inserted = await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.user_role','ADMIN',true), set_config('app.user_id','import',true)`;
  const del = await tx.$executeRaw`DELETE FROM "CorporateCardExpense"`;
  console.log(`기존 행 삭제: ${del}`);
  let count = 0;
  const CHUNK = 500;
  for (let i = 0; i < matched.length; i += CHUNK) {
    const slice = matched.slice(i, i + CHUNK);
    const tuples = slice.map((r) => Prisma.sql`(${crypto.randomUUID()}, ${r.clientId}, ${r.clientName}, ${r.item}, ${r.year}, ${r.month}, ${r.amount}, ${now})`);
    count += await tx.$executeRaw`
      INSERT INTO "CorporateCardExpense" ("id","clientId","clientName","item","year","month","amount","updatedAt")
      VALUES ${Prisma.join(tuples)}`;
  }
  return count;
}, { timeout: 120000, maxWait: 15000 });

console.log(`✓ 적재 완료: ${inserted}행`);
await prisma.$disconnect();
