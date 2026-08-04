# 지급요청 수정/삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/expenses` 지급요청(payment-request) 화면의 수정/삭제 자리표시자(`alert("추후 구현 예정입니다.")`)를 실제 서버 액션으로 연결한다 — 정산담당자는 목록 인라인 편집(지급명의/고객사/사업자명/지급일/지급여부) + 상태 무관 삭제, PM은 상세모달 전체수정(지급준비+본인 건) + 지급준비 건 삭제, 일괄수정 팝업 실동작.

**Architecture:** 지급리스트(Payee)에 이미 구현된 패턴(소프트 삭제 `deletedAt`, ref 기반 인라인 편집 + `useTransition`, "use server" 액션 → `ActionState` 반환 → `revalidatePath`)을 지급요청(PaymentRequest)에 그대로 재사용한다. DB 스키마 변경 없음(모든 대상 컬럼 이미 존재).

**Tech Stack:** Next.js App Router(Server Actions), Prisma + Postgres RLS, zod, Vitest(통합 테스트, 실 DB 트랜잭션).

## Global Constraints

- 삭제는 소프트 삭제만 사용한다(`deletedAt`). 하드 삭제 금지.
- PM의 수정/삭제는 **지급준비(PREPARING) 상태 + 본인 신청 건**에 한정한다. DB RLS(`payment_request_update_pm`)는 `requesterId`만 검사하고 상태는 걸러주지 않으므로, 상태 체크는 반드시 앱 레이어(데이터 계층 함수)가 재검증한다.
- 정산담당자(ADMIN/SETTLEMENT)의 수정/삭제는 상태 무관하게 항상 가능하다.
- `bizName`/`taxType`은 클라이언트 입력을 신뢰하지 않고, 서버가 `payeeId`로 Payee를 재조회해 스냅샷으로 저장한다(등록 플로우와 동일 원칙).
- 상태(status) 필터가 걸린 삭제(`softDeletePaymentRequests`의 `statusIn` 옵션)는 부분삭제를 허용하지 않는다 — 하나라도 매칭 실패하면 전체 실패로 처리한다.
- 기존 `updatePaymentRequestsBulk`(seqNo 기반, 엑셀 재업로드 전용)는 건드리지 않는다. 이번에 추가하는 `updatePaymentRequestsByIds`(id 기반, 일괄수정 팝업용)와는 별개 함수다.
- UI는 지급리스트(Payee) 컴포넌트의 클래스명·구조 컨벤션을 그대로 따른다(같은 CSS 변수, 같은 버튼 스타일).
- 서버 액션(`"use server"` 파일)과 UI 컴포넌트는 이 코드베이스 기존 컨벤션상 전용 단위테스트가 없다(데이터 계층 테스트로 갈음). 타입체크(`npx tsc --noEmit`)와 기존 테스트 스위트 통과로 검증한다.

---

## 파일 구조 개요

| 파일 | 변경 |
|---|---|
| `src/lib/data/payment-requests.ts` | `PaymentRequestRow` 타입에 `payeeId` 추가, 함수 4개 추가 |
| `test/data-payment-requests.test.ts` | 위 변경에 대한 테스트 추가 |
| `src/lib/validation/schemas.ts` | zod 스키마 3개 추가 |
| `test/schemas.test.ts` | 위 스키마 테스트 추가 |
| `src/app/(app)/expenses/payment-request/actions.ts` | 서버 액션 4개 추가 |
| `src/app/(app)/expenses/PaymentRequestDeleteConfirmModal.tsx` | 신규 (Payee 것과 동일 구조) |
| `src/app/(app)/expenses/PaymentRequestRow.tsx` | 신규 (정산담당자 인라인 편집 행) |
| `src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx` | 전면 수정 (실동작 연결, `ids` prop) |
| `src/app/(app)/expenses/PaymentRequestDetailModal.tsx` | 전면 수정 (PM 전체수정 전용으로 전환) |
| `src/app/(app)/expenses/page.tsx` | `payees` prop을 `PaymentRequestListPanel`에 전달 |
| `src/app/(app)/expenses/PaymentRequestListPanel.tsx` | 전면 수정 (버튼 순서/역할 분기/삭제·편집 상태) |

---

### Task 1: 데이터 계층 — 수정/삭제 함수 + payeeId 노출

**Files:**
- Modify: `src/lib/data/payment-requests.ts`
- Test: `test/data-payment-requests.test.ts`

**Interfaces:**
- Produces: `PaymentRequestRow`(타입, `payeeId: string | null` 필드 추가), `updatePaymentRequest(ctx, id, input): Promise<ActionState>`, `updatePaymentRequestPmFields(ctx, id, input): Promise<ActionState>`, `updatePaymentRequestsByIds(ctx, ids, input): Promise<ActionState>`, `softDeletePaymentRequests(ctx, ids, opts?): Promise<ActionState>`.

- [ ] **Step 1: `PaymentRequestRow` 타입에 `payeeId` 추가 + 실패하는 테스트 작성**

`src/lib/data/payment-requests.ts`의 `PaymentRequestRow` 타입(현재 46~65행)에서 `bizName` 다음 줄에 추가:

```ts
export type PaymentRequestRow = {
  id: string;
  seqNo: number;
  requestedAt: Date;
  requesterId: string;
  requesterName: string;
  entity: PaymentRequestEntity;
  clientId: string;
  clientName: string;
  payeeId: string | null;
  bizName: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  amount: number;
  taxType: TaxType;
  memo: string;
  payDate: Date | null;
  status: PaymentRequestStatus;
};
```

`listPaymentRequests`의 매핑 객체(현재 116~135행)에서 `bizName: r.bizName,` 앞에 `payeeId: r.payeeId,` 추가:

```ts
  const mapped = rows.map((r) => ({
    id: r.id,
    seqNo: r.seqNo,
    requestedAt: r.requestedAt,
    requesterId: r.requesterId,
    requesterName: r.requester.name ?? r.requester.email,
    entity: r.entity,
    clientId: r.clientId,
    clientName: r.client.name,
    payeeId: r.payeeId,
    bizName: r.bizName,
    unitPrice: r.unitPrice,
    transportFee: r.transportFee,
    materialFee: r.materialFee,
    count: r.count,
    amount: r.amount,
    taxType: r.taxType,
    memo: r.memo,
    payDate: r.payDate,
    status: r.status,
  }));
```

`test/data-payment-requests.test.ts`에 테스트 추가(`"seqNo는 자동으로..."` 테스트 근처, 아무 `describe` 블록 안이어도 무방):

```ts
  it("payeeId를 포함해서 반환한다(연동 없으면 null)", async () => {
    const { pmA, clientA } = await seed();
    const payee = await createPayee("1111111111", "업체A");
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "연동건" }), payeeId: payee.id },
    }));
    await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
      data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "미연동건" }),
    }));

    const { rows } = await listPaymentRequests(ADMIN);
    const byBizName = new Map(rows.map((r) => [r.bizName, r.payeeId]));
    expect(byBizName.get("연동건")).toBe(payee.id);
    expect(byBizName.get("미연동건")).toBeNull();
  });
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t "payeeId를 포함해서"`
Expected: FAIL (`payeeId` 필드가 아직 없어 `undefined`이거나 타입 에러)

- [ ] **Step 3: Step 1의 타입/매핑 변경 적용**

(Step 1에 이미 실제 코드를 작성했으므로, 이 단계에서 파일에 반영한다.)

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts -t "payeeId를 포함해서"`
Expected: PASS

- [ ] **Step 5: `updatePaymentRequest` 실패하는 테스트 작성**

`test/data-payment-requests.test.ts` 상단 import에 `updatePaymentRequest` 추가:

```ts
import {
  listPaymentRequests, parsePaymentRequestPage, parsePaymentRequestEntity,
  parsePaymentRequestStatus, parsePaymentRequestDateParam, PAYMENT_REQUEST_PAGE_SIZE,
  createPaymentRequestsBulk, listPaymentRequestsForExport, updatePaymentRequestsBulk,
  updatePaymentRequest, updatePaymentRequestPmFields, updatePaymentRequestsByIds,
  softDeletePaymentRequests,
} from "@/lib/data/payment-requests";
```

파일 끝(마지막 `describe` 블록 안, 최상위 `describe("payment-requests 데이터 계층", ...)` 닫는 괄호 앞)에 추가:

```ts
  describe("updatePaymentRequest (정산담당자 인라인 수정)", () => {
    it("지급명의/고객사/사업자명/지급일/지급여부를 한 번에 수정하고 bizName/taxType은 새 Payee 스냅샷으로 갱신한다", async () => {
      const { pmA, clientA, clientB } = await seed();
      const oldPayee = await createPayee("1111111111", "이전사업자", "TAX_INVOICE");
      const newPayee = await createPayee("2222222222", "새사업자", "BUSINESS_INCOME");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "이전사업자" }), payeeId: oldPayee.id },
      }));

      const result = await updatePaymentRequest(ADMIN, created.id, {
        entity: "HUNO_INC", clientId: clientB.id, payeeId: newPayee.id,
        payDate: new Date("2026-08-10"), status: "COMPLETED",
      });
      expect(result.ok).toBe(true);

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.entity).toBe("HUNO_INC");
      expect(row.clientId).toBe(clientB.id);
      expect(row.bizName).toBe("새사업자");
      expect(row.taxType).toBe("BUSINESS_INCOME");
      expect(row.payDate).toEqual(new Date("2026-08-10"));
      expect(row.status).toBe("COMPLETED");
    });

    it("존재하지 않는 payeeId로 수정하면 거부한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id }), payeeId: payee.id },
      }));

      const result = await updatePaymentRequest(ADMIN, created.id, {
        entity: "HUNO", clientId: clientA.id, payeeId: "존재하지않는아이디",
        payDate: null, status: "PREPARING",
      });
      expect(result.ok).toBe(false);
    });

    it("지급완료 상태인 건도 수정할 수 있다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, status: "COMPLETED" }), payeeId: payee.id },
      }));

      const result = await updatePaymentRequest(ADMIN, created.id, {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        payDate: new Date("2026-08-01"), status: "COMPLETED",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("updatePaymentRequestPmFields (PM 상세수정)", () => {
    it("등록 항목을 수정하고 지급액을 서버가 재계산한다", async () => {
      const { pmA, clientA, clientB } = await seed();
      const oldPayee = await createPayee("1111111111", "이전사업자", "TAX_INVOICE");
      const newPayee = await createPayee("2222222222", "새사업자", "BUSINESS_INCOME");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, unitPrice: 10000, count: 1 }), payeeId: oldPayee.id },
      }));

      const result = await updatePaymentRequestPmFields({ userId: pmA.id, role: "PM" }, created.id, {
        entity: "HUNO_INC", clientId: clientB.id, payeeId: newPayee.id,
        unitPrice: 100000, transportFee: 5000, materialFee: 2000, count: 3, memo: "수정된 메모",
      });
      expect(result.ok).toBe(true);

      const { rows: [row] } = await listPaymentRequests(ADMIN);
      expect(row.entity).toBe("HUNO_INC");
      expect(row.clientId).toBe(clientB.id);
      expect(row.bizName).toBe("새사업자");
      expect(row.taxType).toBe("BUSINESS_INCOME");
      expect(row.amount).toBe((100000 + 5000 + 2000) * 3);
      expect(row.memo).toBe("수정된 메모");
    });

    it("존재하지 않는 payeeId로 수정하면 거부한다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id }), payeeId: payee.id },
      }));

      const result = await updatePaymentRequestPmFields({ userId: pmA.id, role: "PM" }, created.id, {
        entity: "HUNO", clientId: clientA.id, payeeId: "존재하지않는아이디",
        unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "",
      });
      expect(result.ok).toBe(false);
    });

    it("지급완료 건은 수정할 수 없다", async () => {
      const { pmA, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmA.id, clientId: clientA.id, status: "COMPLETED" }), payeeId: payee.id },
      }));

      const result = await updatePaymentRequestPmFields({ userId: pmA.id, role: "PM" }, created.id, {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "",
      });
      expect(result.ok).toBe(false);
    });

    it("타인이 신청한 건은 수정할 수 없다", async () => {
      const { pmA, pmB, clientA } = await seed();
      const payee = await createPayee("1111111111", "업체A");
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({
        data: { ...baseInput({ requesterId: pmB.id, clientId: clientA.id }), payeeId: payee.id },
      }));

      const result = await updatePaymentRequestPmFields({ userId: pmA.id, role: "PM" }, created.id, {
        entity: "HUNO", clientId: clientA.id, payeeId: payee.id,
        unitPrice: 10000, transportFee: 0, materialFee: 0, count: 1, memo: "",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("updatePaymentRequestsByIds (일괄수정)", () => {
    it("선택된 여러 건에 동일한 지급일/지급여부를 반영한다", async () => {
      const { pmA, clientA } = await seed();
      const a = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }) }));
      const b = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건" }) }));

      const result = await updatePaymentRequestsByIds(ADMIN, [a.id, b.id], { payDate: new Date("2026-08-15"), status: "COMPLETED" });
      expect(result.ok).toBe(true);

      const { rows } = await listPaymentRequests(ADMIN);
      for (const row of rows) {
        expect(row.payDate).toEqual(new Date("2026-08-15"));
        expect(row.status).toBe("COMPLETED");
      }
    });

    it("매칭되는 건이 하나도 없으면 거부한다", async () => {
      const result = await updatePaymentRequestsByIds(ADMIN, ["존재하지않는아이디"], { payDate: null, status: "COMPLETED" });
      expect(result.ok).toBe(false);
    });

    it("소프트 삭제된 건은 매칭 대상에서 제외한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));
      await withRLS(ADMIN, (tx) => tx.paymentRequest.update({ where: { id: created.id }, data: { deletedAt: new Date() } }));

      const result = await updatePaymentRequestsByIds(ADMIN, [created.id], { payDate: new Date("2026-08-01"), status: "COMPLETED" });
      expect(result.ok).toBe(false);
    });
  });

  describe("softDeletePaymentRequests", () => {
    it("정상 삭제 후 deletedAt이 채워지고 목록에서 제외된다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id }) }));

      const result = await softDeletePaymentRequests(ADMIN, [created.id]);
      expect(result.ok).toBe(true);

      const deleted = await withRLS(ADMIN, (tx) => tx.paymentRequest.findUnique({ where: { id: created.id } }));
      expect(deleted?.deletedAt).not.toBeNull();
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("여러 건을 한 번에 삭제한다", async () => {
      const { pmA, clientA } = await seed();
      const a = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "A건" }) }));
      const b = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "B건" }) }));

      const result = await softDeletePaymentRequests(ADMIN, [a.id, b.id]);
      expect(result.ok).toBe(true);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(0);
    });

    it("매칭되는 건이 하나도 없으면 거부한다", async () => {
      const result = await softDeletePaymentRequests(ADMIN, ["존재하지않는아이디"]);
      expect(result.ok).toBe(false);
    });

    it("statusIn 옵션으로 지급완료 건 삭제를 시도하면(PM 시나리오) 거부한다", async () => {
      const { pmA, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, status: "COMPLETED" }) }));

      const result = await softDeletePaymentRequests(ADMIN, [created.id], { statusIn: ["PREPARING"] });
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(1);
    });

    it("statusIn 옵션에서 일부만 매칭되면(지급준비/지급완료 혼합) 전체 실패한다(부분삭제 없음)", async () => {
      const { pmA, clientA } = await seed();
      const preparing = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "준비건", status: "PREPARING" }) }));
      const completed = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmA.id, clientId: clientA.id, bizName: "완료건", status: "COMPLETED" }) }));

      const result = await softDeletePaymentRequests(ADMIN, [preparing.id, completed.id], { statusIn: ["PREPARING"] });
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(2);
    });

    it("PM은 타인이 신청한 건을 삭제할 수 없다(RLS)", async () => {
      const { pmA, pmB, clientA } = await seed();
      const created = await withRLS(ADMIN, (tx) => tx.paymentRequest.create({ data: baseInput({ requesterId: pmB.id, clientId: clientA.id, status: "PREPARING" }) }));

      const result = await softDeletePaymentRequests({ userId: pmA.id, role: "PM" }, [created.id], { statusIn: ["PREPARING"] });
      expect(result.ok).toBe(false);
      expect((await listPaymentRequests(ADMIN)).rows).toHaveLength(1);
    });
  });
```

- [ ] **Step 6: 테스트 실행해 실패 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: FAIL with "updatePaymentRequest is not a function" (또는 import 에러)

- [ ] **Step 7: 4개 함수 구현**

`src/lib/data/payment-requests.ts`의 `updatePaymentRequestsBulk` 함수 뒤(파일 끝)에 추가:

```ts
export type PaymentRequestSettlementUpdateInput = {
  entity: PaymentRequestEntity;
  clientId: string;
  payeeId: string;
  payDate: Date | null;
  status: PaymentRequestStatus;
};

// 정산담당자 인라인 수정. payeeId로 Payee를 다시 조회해 bizName/taxType을 스냅샷으로
// 갱신한다(클라이언트가 보낸 이름은 신뢰하지 않음 — 등록 때와 동일 원칙). 상태 무관하게
// 항상 수정 가능(정산담당자는 최고 권한).
export async function updatePaymentRequest(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestSettlementUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const payee = await tx.payee.findFirst({
      where: { id: input.payeeId, deletedAt: null },
      select: { bizName: true, taxType: true },
    });
    if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };

    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName: payee.bizName,
        taxType: payee.taxType,
        payDate: input.payDate,
        status: input.status,
      },
    });
    return { ok: true };
  });
}

export type PaymentRequestPmUpdateInput = {
  entity: PaymentRequestEntity;
  clientId: string;
  payeeId: string;
  unitPrice: number;
  transportFee: number;
  materialFee: number;
  count: number;
  memo: string;
};

// PM 상세수정. 지급준비 상태 + 본인 신청 건인지를 이 함수가 직접 재검증한다 — DB RLS
// (payment_request_update_pm)는 requesterId만 검사하고 상태는 걸러주지 않으므로, 이
// 앱 레이어 체크가 없으면 PM이 지급완료 건도 수정할 수 있게 된다. amount는 서버가
// (unitPrice+transportFee+materialFee)*count로 재계산한다.
export async function updatePaymentRequestPmFields(
  ctx: RlsContext,
  id: string,
  input: PaymentRequestPmUpdateInput,
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const current = await tx.paymentRequest.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, requesterId: true },
    });
    if (!current || current.status !== "PREPARING" || current.requesterId !== ctx.userId) {
      return { ok: false, error: "수정할 수 없는 건입니다." };
    }

    const payee = await tx.payee.findFirst({
      where: { id: input.payeeId, deletedAt: null },
      select: { bizName: true, taxType: true },
    });
    if (!payee) return { ok: false, error: "선택한 사업자를 찾을 수 없습니다. 다시 선택해 주세요." };

    const amount = (input.unitPrice + input.transportFee + input.materialFee) * input.count;
    await tx.paymentRequest.update({
      where: { id },
      data: {
        entity: input.entity,
        clientId: input.clientId,
        payeeId: input.payeeId,
        bizName: payee.bizName,
        taxType: payee.taxType,
        unitPrice: input.unitPrice,
        transportFee: input.transportFee,
        materialFee: input.materialFee,
        count: input.count,
        amount,
        memo: input.memo,
      },
    });
    return { ok: true };
  });
}

// 일괄수정(체크박스 선택 → 지급일/지급여부 동일 적용). id 기반이라 엑셀 재업로드용
// updatePaymentRequestsBulk(seqNo 기반, "찾은 것만 갱신")와는 별개다.
export async function updatePaymentRequestsByIds(
  ctx: RlsContext,
  ids: string[],
  input: { payDate: Date | null; status: PaymentRequestStatus },
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const result = await tx.paymentRequest.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { payDate: input.payDate, status: input.status },
    });
    if (result.count === 0) return { ok: false, error: "수정할 항목을 찾을 수 없습니다." };
    return { ok: true };
  });
}

// 소프트 삭제. Payee의 softDeletePayees와 동일한 updateMany 패턴. opts.statusIn이 있으면
// 그 상태의 행만 대상으로 삼는다(PM 삭제 시 ["PREPARING"]을 넘겨 지급완료 건이 섞여도
// 삭제되지 않게 막는다). 매칭된 count가 ids.length보다 작으면(권한 없는 행이나 상태가
// 안 맞는 행이 섞여 있었다는 뜻) 부분삭제 대신 전체 실패로 처리한다 — 조용한 부분성공보다
// 명확한 에러가 낫다.
export async function softDeletePaymentRequests(
  ctx: RlsContext,
  ids: string[],
  opts?: { statusIn?: PaymentRequestStatus[] },
): Promise<ActionState> {
  return withRLS(ctx, async (tx) => {
    const where: Prisma.PaymentRequestWhereInput = { id: { in: ids }, deletedAt: null };
    if (opts?.statusIn) where.status = { in: opts.statusIn };

    const result = await tx.paymentRequest.updateMany({ where, data: { deletedAt: new Date() } });
    if (result.count === 0) return { ok: false, error: "삭제할 항목을 찾을 수 없습니다." };
    if (result.count < ids.length) return { ok: false, error: "삭제할 수 없는 항목이 포함되어 있습니다." };
    return { ok: true };
  });
}
```

- [ ] **Step 8: 테스트 실행해 통과 확인**

Run: `npx vitest run test/data-payment-requests.test.ts`
Expected: PASS (전체)

- [ ] **Step 9: Commit**

```bash
git add src/lib/data/payment-requests.ts test/data-payment-requests.test.ts
git commit -m "feat(payment-request): 수정/삭제 데이터 계층 함수 추가"
```

---

### Task 2: 검증 스키마

**Files:**
- Modify: `src/lib/validation/schemas.ts`
- Test: `test/schemas.test.ts`

**Interfaces:**
- Consumes: 없음(zod만 사용)
- Produces: `paymentRequestUpdateSchema`, `paymentRequestUpdatePmSchema`, `paymentRequestBulkUpdateSchema`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/schemas.test.ts` 상단 import에 3개 추가:

```ts
import {
  performanceBatchSchema,
  expenseSchema,
  billingSchema,
  taskSchema,
  clientSchema,
  payeeUploadRowSchema,
  payeeUpdateSchema,
  payeeUpdatePmSchema,
  paymentRequestRowSchema,
  paymentRequestUpdateSchema,
  paymentRequestUpdatePmSchema,
  paymentRequestBulkUpdateSchema,
} from "@/lib/validation/schemas";
```

파일 끝에 추가:

```ts
describe("paymentRequestUpdateSchema (정산담당자 인라인 수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "2026-08-05", status: "COMPLETED",
    });
    expect(r.success).toBe(true);
  });
  it("빈 지급일은 null이 된다", () => {
    const r = paymentRequestUpdateSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "PREPARING",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payDate).toBeNull();
  });
  it("알 수 없는 entity/status는 거부한다", () => {
    expect(paymentRequestUpdateSchema.safeParse({ entity: "NOPE", clientId: "c1", payeeId: "p1", payDate: "", status: "PREPARING" }).success).toBe(false);
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "c1", payeeId: "p1", payDate: "", status: "NOPE" }).success).toBe(false);
  });
  it("clientId/payeeId가 비어있으면 거부한다", () => {
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "", payeeId: "p1", payDate: "", status: "PREPARING" }).success).toBe(false);
    expect(paymentRequestUpdateSchema.safeParse({ entity: "HUNO", clientId: "c1", payeeId: "", payDate: "", status: "PREPARING" }).success).toBe(false);
  });
});

describe("paymentRequestUpdatePmSchema (PM 상세수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO_INC", clientId: "c1", payeeId: "p1",
      unitPrice: "100000", transportFee: "0", materialFee: "0", count: "1", memo: "메모",
    });
    expect(r.success).toBe(true);
  });
  it("단가/횟수가 0이면 거부한다", () => {
    expect(paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "0", transportFee: "0", materialFee: "0", count: "1", memo: "",
    }).success).toBe(false);
    expect(paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "1", transportFee: "0", materialFee: "0", count: "0", memo: "",
    }).success).toBe(false);
  });
  it("교통비/재료비는 0을 허용한다", () => {
    const r = paymentRequestUpdatePmSchema.safeParse({
      entity: "HUNO", clientId: "c1", payeeId: "p1",
      unitPrice: "1", transportFee: "0", materialFee: "0", count: "1", memo: "",
    });
    expect(r.success).toBe(true);
  });
});

describe("paymentRequestBulkUpdateSchema (일괄수정)", () => {
  it("정상 입력을 통과시킨다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "2026-08-05", status: "COMPLETED" });
    expect(r.success).toBe(true);
  });
  it("빈 지급일은 null이 된다", () => {
    const r = paymentRequestBulkUpdateSchema.safeParse({ payDate: "", status: "PREPARING" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.payDate).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: FAIL (import 에러 — 스키마가 아직 없음)

- [ ] **Step 3: 스키마 구현**

`src/lib/validation/schemas.ts`의 `payeeUpdatePmSchema` 정의 다음, `paymentRequestRowSchema` 앞 또는 뒤 아무 곳에 추가(파일 끝 권장):

```ts
// 지급요청 인라인 수정(정산담당자) — 지급명의/고객사/사업자명/지급일/지급여부.
export const paymentRequestUpdateSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  payDate: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
});

// 지급요청 상세수정(PM) — 등록 시 작성한 항목 전체(지급일/지급여부 제외, 정산담당자 전담).
export const paymentRequestUpdatePmSchema = z.object({
  entity: z.enum(["HUNO", "HUNO_INC"]),
  clientId: z.string().min(1),
  payeeId: z.string().min(1),
  unitPrice: z.coerce.number().int().min(1),
  transportFee: z.coerce.number().int().min(0),
  materialFee: z.coerce.number().int().min(0),
  count: z.coerce.number().int().min(1),
  memo: z.string(),
});

// 지급요청 일괄수정 — 선택된 건들에 동일하게 적용할 지급일/지급여부.
export const paymentRequestBulkUpdateSchema = z.object({
  payDate: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.date().nullable()),
  status: z.enum(["PREPARING", "COMPLETED"]),
});
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npx vitest run test/schemas.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/schemas.ts test/schemas.test.ts
git commit -m "feat(payment-request): 수정 검증 스키마 추가"
```

---

### Task 3: 서버 액션

**Files:**
- Modify: `src/app/(app)/expenses/payment-request/actions.ts`

**Interfaces:**
- Consumes: `updatePaymentRequest`, `updatePaymentRequestPmFields`, `updatePaymentRequestsByIds`, `softDeletePaymentRequests`(Task 1), `paymentRequestUpdateSchema`, `paymentRequestUpdatePmSchema`, `paymentRequestBulkUpdateSchema`(Task 2)
- Produces: `updatePaymentRequestAction(id, formData): Promise<ActionState>`, `updatePaymentRequestPmAction(id, formData): Promise<ActionState>`, `bulkUpdatePaymentRequestsAction(ids, formData): Promise<ActionState>`, `deletePaymentRequestsAction(ids): Promise<ActionState>`

이 파일은 `"use server"`(Next 서버 액션)라 이 코드베이스 컨벤션상 전용 단위테스트가 없다(Task 1에서 실제 로직은 이미 테스트됨). 타입체크로 검증한다.

- [ ] **Step 1: import 추가**

`src/app/(app)/expenses/payment-request/actions.ts` 상단 import 블록을 다음으로 교체:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { getRlsContext } from "@/lib/context";
import {
  updatePaymentRequestsBulk, updatePaymentRequest, updatePaymentRequestPmFields,
  updatePaymentRequestsByIds, softDeletePaymentRequests,
} from "@/lib/data/payment-requests";
import { buildPaymentRequestUpdatesFromRows } from "@/lib/data/payment-request-upload";
import { parseXlsxToRows } from "../payees/xlsx";
import {
  paymentRequestUpdateSchema, paymentRequestUpdatePmSchema, paymentRequestBulkUpdateSchema,
} from "@/lib/validation/schemas";
import { SAVED, type ActionState } from "@/lib/action-state";
import type { PaymentRequestUploadState } from "./upload-state";
```

- [ ] **Step 2: 4개 액션 추가**

기존 `uploadPaymentRequestUpdatesAction` 함수 뒤(파일 끝)에 추가:

```ts
export async function updatePaymentRequestAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT"); // ADMIN도 랭크상 통과
  const ctx = getRlsContext(user);

  const parsed = paymentRequestUpdateSchema.safeParse({
    entity: formData.get("entity"),
    clientId: formData.get("clientId"),
    payeeId: formData.get("payeeId"),
    payDate: formData.get("payDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequest(ctx, id, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function updatePaymentRequestPmAction(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireRole("PM");
  const ctx = getRlsContext(user);

  const parsed = paymentRequestUpdatePmSchema.safeParse({
    entity: formData.get("entity"),
    clientId: formData.get("clientId"),
    payeeId: formData.get("payeeId"),
    unitPrice: formData.get("unitPrice"),
    transportFee: formData.get("transportFee"),
    materialFee: formData.get("materialFee"),
    count: formData.get("count"),
    memo: formData.get("memo"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequestPmFields(ctx, id, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request update-pm] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function bulkUpdatePaymentRequestsAction(ids: string[], formData: FormData): Promise<ActionState> {
  const user = await requireRole("SETTLEMENT");
  const ctx = getRlsContext(user);

  const parsed = paymentRequestBulkUpdateSchema.safeParse({
    payDate: formData.get("payDate"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "입력값을 확인하세요." };

  try {
    const result = await updatePaymentRequestsByIds(ctx, ids, parsed.data);
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request bulk-update] 수정 실패:", e);
    return { ok: false, error: "수정 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}

export async function deletePaymentRequestsAction(ids: string[]): Promise<ActionState> {
  const user = await requireRole("PM"); // ADMIN/SETTLEMENT도 랭크상 통과
  const ctx = getRlsContext(user);

  try {
    const result = await softDeletePaymentRequests(
      ctx, ids,
      user.role === "PM" ? { statusIn: ["PREPARING"] } : undefined,
    );
    if (!result.ok) return result;
  } catch (e) {
    console.error("[payment-request delete] 삭제 실패:", e);
    return { ok: false, error: "삭제 중 오류가 발생했습니다. 잠시 후 다시 시도하세요." };
  }

  revalidatePath("/expenses");
  return SAVED;
}
```

- [ ] **Step 3: 타입체크 + 기존 테스트 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npx vitest run`
Expected: 전체 PASS (기존 테스트 회귀 없음)

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/expenses/payment-request/actions.ts
git commit -m "feat(payment-request): 수정/삭제 서버 액션 추가"
```

---

### Task 4: 삭제 확인 모달 (신규)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestDeleteConfirmModal.tsx`

**Interfaces:**
- Produces: `PaymentRequestDeleteConfirmModal({ open, count, pending, error, onConfirm, onCancel })` — `PayeeDeleteConfirmModal`과 동일한 props/동작.

- [ ] **Step 1: 파일 생성**

`src/app/(app)/expenses/PayeeDeleteConfirmModal.tsx`와 완전히 동일한 구조로 작성(엔티티명만 통일):

```tsx
"use client";

export function PaymentRequestDeleteConfirmModal({
  open,
  count,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  count: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={pending ? undefined : onCancel}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 text-lg font-semibold">삭제 확인</h2>
        <p className="mb-4 text-sm text-[var(--color-muted)]">
          {count}건을 삭제하시겠습니까?<br />
          삭제된 항목은 목록에서 숨겨집니다.
        </p>
        {error && <p className="mb-4 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {pending ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음(아직 아무도 이 컴포넌트를 import하지 않으므로 미사용 경고 없음 — 신규 파일이라 별도 확인 불필요)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PaymentRequestDeleteConfirmModal.tsx"
git commit -m "feat(payment-request): 삭제 확인 모달 추가"
```

---

### Task 5: 정산담당자 인라인 편집 행 (신규)

**Files:**
- Create: `src/app/(app)/expenses/PaymentRequestRow.tsx`

**Interfaces:**
- Consumes: `updatePaymentRequestAction`(Task 3), `PaymentRequestRow`(타입, Task 1의 `payeeId` 포함 버전), `PayeeOption`(`@/lib/data/payees`), `PayeeCombobox`, `PaymentRequestClientCombobox`
- Produces: `PaymentRequestRow({ row, isEditing, isSelected, clients, payees, onToggleSelect, onStartEdit, onStopEdit, onRequestDelete })` (컴포넌트)

- [ ] **Step 1: 파일 생성**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentRequestRow as PaymentRequestRowData } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL,
  paymentRequestEntityLabel, paymentRequestStatusLabel,
} from "@/lib/labels";
import { formatWon } from "@/lib/format";
import { updatePaymentRequestAction } from "./payment-request/actions";

const inputCls =
  "w-full rounded border-2 border-[var(--color-primary)]/50 bg-[var(--color-surface)] px-2 py-1.5 text-center text-sm shadow-sm focus:border-[var(--color-primary)] focus:outline-none";
const cellCls = "whitespace-nowrap px-3 py-2 text-center align-middle";

function dateStr(d: Date | null): string {
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-";
}

// 정산담당자/관리자 전용 인라인 편집 행. 지급명의/고객사/사업자명/지급일/지급여부를
// 한 번에 편집하고 저장한다(PayeeRow.tsx와 동일한 ref 기반 편집 패턴).
export function PaymentRequestRow({
  row,
  isEditing,
  isSelected,
  clients,
  payees,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onRequestDelete,
}: {
  row: PaymentRequestRowData;
  isEditing: boolean;
  isSelected: boolean;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const entityRef = useRef<HTMLSelectElement>(null);
  const payDateRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const [clientId, setClientId] = useState(row.clientId);
  const [payeeId, setPayeeId] = useState<string | null>(row.payeeId);

  function handleCancel() {
    setError(null);
    setClientId(row.clientId);
    setPayeeId(row.payeeId);
    onStopEdit();
  }

  function handleSave() {
    if (!payeeId) {
      setError("사업자명을 선택하세요.");
      return;
    }
    const formData = new FormData();
    formData.set("entity", entityRef.current!.value);
    formData.set("clientId", clientId);
    formData.set("payeeId", payeeId);
    formData.set("payDate", payDateRef.current!.value);
    formData.set("status", statusRef.current!.value);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestAction(row.id, formData);
      if (result.ok) {
        router.refresh();
        onStopEdit();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <tr className={`border-b border-[var(--color-border)] ${isEditing || isSelected ? "bg-[var(--color-hover)]" : ""}`}>
      <td className={cellCls}>
        <input type="checkbox" checked={isSelected} onChange={onToggleSelect} aria-label={`${row.bizName} 선택`} />
      </td>
      <td className={cellCls}>{row.seqNo}</td>
      <td className={cellCls}>{dateStr(row.requestedAt)}</td>
      <td className={cellCls}>{row.requesterName}</td>
      <td className={cellCls}>
        {isEditing ? (
          <select ref={entityRef} className={inputCls} defaultValue={row.entity}>
            {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
              <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
            ))}
          </select>
        ) : (
          paymentRequestEntityLabel(row.entity)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? "")} />
        ) : (
          row.clientName
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <PayeeCombobox payees={payees} selectedId={payeeId} onSelect={(p) => setPayeeId(p?.id ?? null)} />
        ) : (
          row.bizName
        )}
      </td>
      <td className={cellCls}>{formatWon(row.amount)}</td>
      <td className={cellCls}>
        {isEditing ? (
          <input
            ref={payDateRef}
            type="date"
            defaultValue={row.payDate ? row.payDate.toISOString().slice(0, 10) : ""}
            className={inputCls}
          />
        ) : (
          dateStr(row.payDate)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <select ref={statusRef} className={inputCls} defaultValue={row.status}>
            <option value="PREPARING">지급준비</option>
            <option value="COMPLETED">지급완료</option>
          </select>
        ) : (
          paymentRequestStatusLabel(row.status)
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <div className="flex flex-col items-center gap-1">
            <div className="flex justify-center gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="whitespace-nowrap rounded bg-[var(--color-success)] px-3 py-1.5 text-xs text-white disabled:opacity-60"
              >
                {pending ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="whitespace-nowrap rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
              >
                취소
              </button>
            </div>
            {error && <p className="whitespace-normal text-xs text-[var(--color-danger)]">{error}</p>}
          </div>
        ) : (
          <div className="flex justify-center gap-2">
            <button type="button" onClick={onStartEdit} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="편집">✏️</button>
            <button type="button" onClick={onRequestDelete} className="text-[var(--color-muted)] hover:text-[var(--color-danger)]" aria-label="삭제">🗑️</button>
          </div>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PaymentRequestRow.tsx"
git commit -m "feat(payment-request): 정산담당자 인라인 편집 행 컴포넌트 추가"
```

---

### Task 6: 일괄수정 팝업 실동작 연결

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx`

**Interfaces:**
- Consumes: `bulkUpdatePaymentRequestsAction`(Task 3)
- Produces: `PaymentRequestBulkUpdateModal({ ids, onClose, onSuccess })` — 기존 `{ count, onClose }`에서 시그니처 변경(호출부는 Task 8에서 갱신).

- [ ] **Step 1: 파일 전체 교체**

```tsx
"use client";

import { useState, useTransition } from "react";
import { bulkUpdatePaymentRequestsAction } from "./payment-request/actions";

// 체크박스로 선택한 여러 건에 같은 지급일/지급여부를 한 번에 적용하는 팝업.
export function PaymentRequestBulkUpdateModal({
  ids,
  onClose,
  onSuccess,
}: {
  ids: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [payDate, setPayDate] = useState("");
  const [status, setStatus] = useState<"PREPARING" | "COMPLETED">("COMPLETED");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleApply() {
    const formData = new FormData();
    formData.set("payDate", payDate);
    formData.set("status", status);

    setError(null);
    startTransition(async () => {
      const result = await bulkUpdatePaymentRequestsAction(ids, formData);
      if (result.ok) {
        onSuccess();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={pending ? undefined : onClose}>
      <div className="w-full max-w-sm rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">수정</h2>
          <button type="button" onClick={onClose} disabled={pending} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-muted)]">선택한 {ids.length}건에 동일한 지급일/지급여부를 적용합니다.</p>
        <label className="flex flex-col text-xs text-[var(--color-muted)]">
          지급일
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm" />
        </label>
        <label className="mt-3 flex flex-col text-xs text-[var(--color-muted)]">
          지급여부
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 rounded border border-[var(--color-border)] px-2 py-2 text-sm">
            <option value="PREPARING">지급준비</option>
            <option value="COMPLETED">지급완료</option>
          </select>
        </label>
        {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-60">취소</button>
          <button type="button" onClick={handleApply} disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
            {pending ? "적용 중..." : "적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 이 시점에는 `PaymentRequestListPanel.tsx`가 아직 옛 `count` prop으로 이 컴포넌트를 호출하고 있어 **에러가 나는 것이 정상**이다(Task 8에서 호출부를 맞추기 전까지 과도기 상태). 에러 메시지가 `count`/`ids` prop 불일치임을 확인만 하고 다음 태스크로 진행한다.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PaymentRequestBulkUpdateModal.tsx"
git commit -m "feat(payment-request): 일괄수정 팝업 실동작 연결"
```

---

### Task 7: PM 상세수정 모달 재작성

**Files:**
- Modify: `src/app/(app)/expenses/PaymentRequestDetailModal.tsx`

**Interfaces:**
- Consumes: `updatePaymentRequestPmAction`(Task 3), `PayeeOption`, `PayeeCombobox`, `PaymentRequestClientCombobox`, `formatThousands`(`@/lib/format`)
- Produces: `PaymentRequestDetailModal({ row, role, currentUserId, clients, payees, onClose })` — 기존 시그니처에 `clients`/`payees` 추가, 정산담당자 편집 분기 제거.

- [ ] **Step 1: 파일 전체 교체**

```tsx
// src/app/(app)/expenses/PaymentRequestDetailModal.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentRequestRow } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { PayeeCombobox } from "@/components/PayeeCombobox";
import { PaymentRequestClientCombobox } from "@/components/PaymentRequestClientCombobox";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL,
  taxTypeLabel, paymentRequestEntityLabel, paymentRequestStatusLabel,
} from "@/lib/labels";
import { formatThousands, formatWon } from "@/lib/format";
import { updatePaymentRequestPmAction } from "./payment-request/actions";

// PM 전용 상세/수정 모달. 지급완료 전 + 본인 신청 건에 한해 등록 시 작성한 항목
// 전체(지급명의/고객사/사업자명/단가/교통비/재료비/횟수/상세내역)를 수정할 수 있다.
// 지급일/지급여부는 정산담당자 전담이라 항상 읽기전용이다. 정산담당자/관리자는 이
// 모달을 쓰지 않는다(목록 화면 인라인 편집으로 대체 — PaymentRequestRow.tsx).
export function PaymentRequestDetailModal({
  row,
  role,
  currentUserId,
  clients,
  payees,
  onClose,
}: {
  row: PaymentRequestRow;
  role: AppRole;
  currentUserId: string;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const canEditPmFields = role === "PM" && row.status === "PREPARING" && row.requesterId === currentUserId;

  const [entity, setEntity] = useState(row.entity);
  const [clientId, setClientId] = useState(row.clientId);
  const [payeeId, setPayeeId] = useState<string | null>(row.payeeId);
  const [taxType, setTaxType] = useState(row.taxType);
  const [unitPrice, setUnitPrice] = useState(String(row.unitPrice));
  const [transportFee, setTransportFee] = useState(String(row.transportFee));
  const [materialFee, setMaterialFee] = useState(String(row.materialFee));
  const [count, setCount] = useState(String(row.count));
  const [memo, setMemo] = useState(row.memo);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const previewTotal = ((Number(unitPrice) || 0) + (Number(transportFee) || 0) + (Number(materialFee) || 0)) * (Number(count) || 0);

  function handleSave() {
    if (!payeeId) {
      setError("사업자명을 선택하세요.");
      return;
    }
    const formData = new FormData();
    formData.set("entity", entity);
    formData.set("clientId", clientId);
    formData.set("payeeId", payeeId);
    formData.set("unitPrice", unitPrice);
    formData.set("transportFee", transportFee);
    formData.set("materialFee", materialFee);
    formData.set("count", count);
    formData.set("memo", memo);

    setError(null);
    startTransition(async () => {
      const result = await updatePaymentRequestPmAction(row.id, formData);
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.error ?? "수정 중 오류가 발생했습니다.");
      }
    });
  }

  const fieldCls = "flex flex-col text-xs text-[var(--color-muted)]";
  const valueCls = "mt-1 text-sm text-[var(--color-fg)]";
  const inputCls = "mt-1 rounded border border-[var(--color-border)] px-2 py-1.5 text-center text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-[14px] bg-[var(--color-surface)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">지급요청 상세</h2>
          <button type="button" onClick={onClose} className="text-[var(--color-muted)]" aria-label="닫기">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldCls}>신청일<span className={valueCls}>{row.requestedAt.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })}</span></div>
          <div className={fieldCls}>신청인<span className={valueCls}>{row.requesterName}</span></div>

          <label className={fieldCls}>
            지급명의
            {canEditPmFields ? (
              <select value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)} className={inputCls}>
                {PAYMENT_REQUEST_ENTITY_LABELS.map((label) => (
                  <option key={label} value={PAYMENT_REQUEST_ENTITY_BY_LABEL[label]}>{label}</option>
                ))}
              </select>
            ) : (
              <span className={valueCls}>{paymentRequestEntityLabel(row.entity)}</span>
            )}
          </label>

          <label className={fieldCls}>
            고객사
            {canEditPmFields ? (
              <PaymentRequestClientCombobox clients={clients} selectedId={clientId} onSelect={(c) => setClientId(c?.id ?? "")} />
            ) : (
              <span className={valueCls}>{row.clientName}</span>
            )}
          </label>

          <label className={fieldCls}>
            사업자명(이름)
            {canEditPmFields ? (
              <PayeeCombobox
                payees={payees}
                selectedId={payeeId}
                onSelect={(p) => { setPayeeId(p?.id ?? null); setTaxType(p?.taxType ?? row.taxType); }}
              />
            ) : (
              <span className={valueCls}>{row.bizName}</span>
            )}
          </label>

          <div className={fieldCls}>청구방식<span className={valueCls}>{taxTypeLabel(canEditPmFields ? taxType : row.taxType)}</span></div>

          <label className={fieldCls}>
            단가
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(unitPrice)} onChange={(e) => setUnitPrice(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.unitPrice)}</span>
            )}
          </label>
          <label className={fieldCls}>
            교통비
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(transportFee)} onChange={(e) => setTransportFee(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.transportFee)}</span>
            )}
          </label>
          <label className={fieldCls}>
            재료비
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={formatThousands(materialFee)} onChange={(e) => setMaterialFee(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{formatWon(row.materialFee)}</span>
            )}
          </label>
          <label className={fieldCls}>
            횟수
            {canEditPmFields ? (
              <input type="text" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.count}</span>
            )}
          </label>

          <div className={fieldCls}>지급액<span className={valueCls}>{formatWon(canEditPmFields ? previewTotal : row.amount)}</span></div>

          <label className="col-span-2 flex flex-col text-xs text-[var(--color-muted)]">
            상세내역(비고)
            {canEditPmFields ? (
              <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputCls} />
            ) : (
              <span className={valueCls}>{row.memo}</span>
            )}
          </label>

          <div className={fieldCls}>지급일<span className={valueCls}>{row.payDate ? row.payDate.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-"}</span></div>
          <div className={fieldCls}>지급여부<span className={valueCls}>{paymentRequestStatusLabel(row.status)}</span></div>
        </div>

        {!canEditPmFields && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">지급완료된 건이거나 수정 권한이 없어 읽기전용으로 표시됩니다.</p>
        )}
        {error && <p className="mt-4 text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">닫기</button>
          {canEditPmFields && (
            <button type="button" onClick={handleSave} disabled={pending} className="rounded bg-[var(--color-primary)] px-5 py-2 text-sm text-white disabled:opacity-60">
              {pending ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 이 시점에는 `PaymentRequestListPanel.tsx`가 아직 옛 시그니처(`clients`/`payees` 없이)로 이 컴포넌트를 호출하고 있어 **에러가 나는 것이 정상**이다(Task 8에서 호출부를 맞춘다). 에러가 `clients`/`payees` prop 누락임을 확인만 하고 다음 태스크로 진행한다.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/expenses/PaymentRequestDetailModal.tsx"
git commit -m "feat(payment-request): PM 상세수정 모달을 전체 필드 편집으로 재작성"
```

---

### Task 8: 목록 화면 통합 배선

**Files:**
- Modify: `src/app/(app)/expenses/page.tsx`
- Modify: `src/app/(app)/expenses/PaymentRequestListPanel.tsx`

**Interfaces:**
- Consumes: Task 1~7에서 만든 모든 함수/컴포넌트
- Produces: 없음(최종 통합 지점)

- [ ] **Step 1: `page.tsx`에서 `payees`를 `PaymentRequestListPanel`에 전달**

`src/app/(app)/expenses/page.tsx`의 `PaymentRequestTab` 함수 내 `<PaymentRequestListPanel ... />` 호출(현재 244~260행)에서 `clients` prop 다음 줄에 `payees={payees}` 추가:

```tsx
  return (
    <PaymentRequestListPanel
      rows={result.rows}
      page={result.page}
      totalPages={result.totalPages}
      clients={clients.map((c) => ({ id: c.id, name: c.name, businessType: c.businessType }))}
      payees={payees}
      bizNames={bizNames}
      filterValues={{
        payDateFrom: sp.payDateFrom ?? "",
        payDateTo: sp.payDateTo ?? "",
        clientId: sp.clientId ?? "",
        entity: sp.entity ?? "",
        status: sp.status ?? "",
        bizName: sp.bizName ?? "",
      }}
      role={user.role!}
      currentUserId={user.id}
    />
  );
```

- [ ] **Step 2: `PaymentRequestListPanel.tsx` 전체 교체**

```tsx
// src/app/(app)/expenses/PaymentRequestListPanel.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PaymentRequestRow as PaymentRequestRowData } from "@/lib/data/payment-requests";
import type { PayeeOption } from "@/lib/data/payees";
import type { AppRole } from "@/lib/auth/rbac";
import { ClientCombobox } from "@/components/ClientCombobox";
import { SelectDropdown } from "@/components/SelectDropdown";
import { SuggestInput } from "@/components/SuggestInput";
import { PaymentRequestPager } from "./PaymentRequestPager";
import { PaymentRequestNoticeBanner } from "./PaymentRequestNoticeBanner";
import { PaymentRequestDetailModal } from "./PaymentRequestDetailModal";
import { PaymentRequestBulkUpdateModal } from "./PaymentRequestBulkUpdateModal";
import { PaymentRequestExcelUploadModal } from "./PaymentRequestExcelUploadModal";
import { PaymentRequestDeleteConfirmModal } from "./PaymentRequestDeleteConfirmModal";
import { PaymentRequestRow } from "./PaymentRequestRow";
import { deletePaymentRequestsAction } from "./payment-request/actions";
import { formatWon } from "@/lib/format";
import {
  PAYMENT_REQUEST_ENTITY_LABELS, PAYMENT_REQUEST_ENTITY_BY_LABEL, paymentRequestEntityLabel,
  PAYMENT_REQUEST_STATUS_LABELS, paymentRequestStatusLabel,
} from "@/lib/labels";

type FilterValues = {
  payDateFrom: string; payDateTo: string; clientId: string; entity: string; status: string; bizName: string;
};

function dateStr(d: Date | null): string {
  return d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }) : "-";
}

// PM은 지급준비 상태 + 본인 신청 건만 체크박스 선택/삭제 대상이 될 수 있다.
function pmCanAct(row: PaymentRequestRowData, currentUserId: string): boolean {
  return row.status === "PREPARING" && row.requesterId === currentUserId;
}

export function PaymentRequestListPanel({
  rows,
  page,
  totalPages,
  clients,
  payees,
  bizNames,
  filterValues,
  role,
  currentUserId,
}: {
  rows: PaymentRequestRowData[];
  page: number;
  totalPages: number;
  clients: { id: string; name: string; businessType: string | null }[];
  payees: PayeeOption[];
  bizNames: string[];
  filterValues: FilterValues;
  role: AppRole;
  currentUserId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [detailTarget, setDetailTarget] = useState<PaymentRequestRowData | null>(null);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [excelUploadOpen, setExcelUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canExport = role === "ADMIN" || role === "SETTLEMENT";

  // PM은 지급준비+본인 신청 건만 선택 가능 — "전체선택"도 그 범위로 제한한다.
  const selectableRows = role === "PM" ? rows.filter((r) => pmCanAct(r, currentUserId)) : rows;
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableRows.map((r) => r.id)));
  }

  function startEditing(id: string) {
    setEditing((prev) => new Set(prev).add(id));
  }

  function stopEditing(id: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeletePending(true);
    const result = await deletePaymentRequestsAction(deleteTarget);
    setDeletePending(false);
    if (result.ok) {
      setSelected(new Set());
      setDeleteTarget(null);
      router.refresh();
    } else {
      setDeleteError(result.error ?? "삭제 중 오류가 발생했습니다.");
    }
  }

  function handleCancelDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  function handleBulkUpdateSuccess() {
    setSelected(new Set());
    setBulkUpdateOpen(false);
    router.refresh();
  }

  const filterParams: Record<string, string> = {
    payDateFrom: filterValues.payDateFrom,
    payDateTo: filterValues.payDateTo,
    clientId: filterValues.clientId,
    entity: filterValues.entity,
    status: filterValues.status,
    bizName: filterValues.bizName,
  };

  // 체크된 행이 있으면 그 항목만, 없으면 현재 검색/필터 결과 전체를 다운로드 대상으로 삼는다.
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const exportHref = selectedIds.length > 0
    ? `/expenses/payment-request/export?ids=${encodeURIComponent(selectedIds.join(","))}`
    : `/expenses/payment-request/export?${new URLSearchParams(filterParams).toString()}`;

  return (
    <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <PaymentRequestNoticeBanner />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-hover)] p-4">
        <input type="hidden" name="tab" value="payment-request" />
        <div className="flex flex-1 flex-wrap items-end justify-center gap-3">
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급명의
            <SelectDropdown
              name="entity"
              defaultValue={filterValues.entity}
              options={[
                { value: "", label: "전체" },
                ...PAYMENT_REQUEST_ENTITY_LABELS.map((label) => ({ value: PAYMENT_REQUEST_ENTITY_BY_LABEL[label], label })),
              ]}
              className="mt-1 w-24"
            />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            고객사
            <ClientCombobox clients={clients} defaultClientId={filterValues.clientId || undefined} className="mt-1 w-64" />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            사업자명(이름)
            <SuggestInput
              name="bizName"
              defaultValue={filterValues.bizName}
              suggestions={bizNames}
              placeholder="사업자명(이름) 검색"
              className="mt-1 w-56"
            />
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급일
            <span className="mt-1 flex items-center gap-1">
              <input type="date" name="payDateFrom" defaultValue={filterValues.payDateFrom} className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm" />
              ~
              <input type="date" name="payDateTo" defaultValue={filterValues.payDateTo} className="w-40 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center text-sm" />
            </span>
          </label>
          <label className="flex flex-col items-center text-sm text-[var(--color-fg)]">
            지급여부
            <SelectDropdown
              name="status"
              defaultValue={filterValues.status}
              options={[
                { value: "", label: "전체" },
                { value: "PREPARING", label: PAYMENT_REQUEST_STATUS_LABELS[0] },
                { value: "COMPLETED", label: PAYMENT_REQUEST_STATUS_LABELS[1] },
              ]}
              className="mt-1 w-24"
            />
          </label>
        </div>
        <button type="submit" className="rounded bg-[var(--color-primary)] px-4 py-2 text-sm text-white">🔍 조회</button>
      </form>

      <div className="mb-4 flex justify-end gap-2">
        {canExport && (
          rows.length > 0 ? (
            <a href={exportHref} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
              📗 엑셀 다운로드{selectedIds.length > 0 ? ` (${selectedIds.length}건 선택)` : ""}
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="다운로드할 데이터가 없습니다"
              className="cursor-not-allowed rounded border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] opacity-50"
            >
              📗 엑셀 다운로드
            </button>
          )
        )}
        {canExport && (
          <button type="button" onClick={() => setExcelUploadOpen(true)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            ⬆ 엑셀 업로드
          </button>
        )}
        {canExport && (
          <button
            type="button"
            onClick={() => setBulkUpdateOpen(true)}
            disabled={selected.size === 0}
            className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            🗓️ 수정{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDeleteTarget(Array.from(selected))}
          disabled={selected.size === 0}
          className="rounded bg-[var(--color-danger)] px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️ 삭제{selected.size > 0 ? ` (${selected.size}건 선택)` : ""}
        </button>
        {role === "PM" && (
          <Link href="/expenses/payment-request/new" className="rounded bg-[var(--color-success)] px-4 py-2 text-sm text-white">
            + 등록
          </Link>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th className="w-10 whitespace-nowrap px-3 py-2 align-middle">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={selectableRows.length === 0} aria-label="전체선택" />
              </th>
              <th className="whitespace-nowrap px-3 py-2">No</th>
              <th className="whitespace-nowrap px-3 py-2">신청일</th>
              <th className="whitespace-nowrap px-3 py-2">신청인</th>
              <th className="whitespace-nowrap px-3 py-2">지급명의</th>
              <th className="whitespace-nowrap px-3 py-2">고객사</th>
              <th className="whitespace-nowrap px-3 py-2">사업자명(이름)</th>
              <th className="whitespace-nowrap px-3 py-2">지급액</th>
              <th className="whitespace-nowrap px-3 py-2">지급일</th>
              <th className="whitespace-nowrap px-3 py-2">지급여부</th>
              <th className="whitespace-nowrap px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {role === "PM" ? rows.map((r) => (
              <tr key={r.id} className={`border-b border-[var(--color-border)] ${selected.has(r.id) ? "bg-[var(--color-hover)]" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2 align-middle">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    disabled={!pmCanAct(r, currentUserId)}
                    aria-label={`${r.bizName} 선택`}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.seqNo}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.requestedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.requesterName}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestEntityLabel(r.entity)}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.clientName}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.bizName}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatWon(r.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{dateStr(r.payDate)}</td>
                <td className="whitespace-nowrap px-3 py-2">{paymentRequestStatusLabel(r.status)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex justify-center gap-2">
                    <button type="button" onClick={() => setDetailTarget(r)} className="text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="편집">✏️</button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget([r.id])}
                      disabled={!pmCanAct(r, currentUserId)}
                      className="text-[var(--color-muted)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="삭제"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            )) : rows.map((r) => (
              <PaymentRequestRow
                key={r.id}
                row={r}
                isEditing={editing.has(r.id)}
                isSelected={selected.has(r.id)}
                clients={clients}
                payees={payees}
                onToggleSelect={() => toggleSelect(r.id)}
                onStartEdit={() => startEditing(r.id)}
                onStopEdit={() => stopEditing(r.id)}
                onRequestDelete={() => setDeleteTarget([r.id])}
              />
            ))}
          </tbody>
        </table>
      </div>

      <PaymentRequestPager page={page} totalPages={totalPages} filterParams={filterParams} />

      {rows.length === 0 && (
        <p className="mt-4 text-center text-sm text-[var(--color-muted)]">
          {Object.values(filterValues).some((v) => v) ? "검색 결과가 없습니다." : "등록된 지급요청이 없습니다."}
        </p>
      )}

      {detailTarget && (
        <PaymentRequestDetailModal
          row={detailTarget}
          role={role}
          currentUserId={currentUserId}
          clients={clients}
          payees={payees}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {bulkUpdateOpen && (
        <PaymentRequestBulkUpdateModal
          ids={Array.from(selected)}
          onClose={() => setBulkUpdateOpen(false)}
          onSuccess={handleBulkUpdateSuccess}
        />
      )}

      {excelUploadOpen && (
        <PaymentRequestExcelUploadModal onClose={() => setExcelUploadOpen(false)} />
      )}

      <PaymentRequestDeleteConfirmModal
        open={deleteTarget !== null}
        count={deleteTarget?.length ?? 0}
        pending={deletePending}
        error={deleteError}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
```

- [ ] **Step 3: 타입체크 + 전체 테스트 + 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음(Task 6·7에서 남겨둔 과도기 에러가 이 단계에서 모두 해소되어야 한다)

Run: `npx vitest run`
Expected: 전체 PASS

Run: `npm run build`
Expected: 빌드 성공(Next.js 타입/린트 체크 포함)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/expenses/page.tsx" "src/app/(app)/expenses/PaymentRequestListPanel.tsx"
git commit -m "feat(payment-request): 목록 화면 수정/삭제 배선 완료 (버튼 순서/역할별 관리 UI)"
```

---

### Task 9: 수동 검증

**Files:** 없음(코드 변경 없음)

개발 DB에 시드 데이터가 있다고 가정한다(`npm run seed` 실행됨, `prisma/seed.js` 기준 계정: `oes@huno.kr`=SETTLEMENT, `lsj@huno.kr`=PM, `shryu@huno.kr`=ADMIN). 로그인 방식(매직링크 등)은 프로젝트 기존 인증 흐름을 따른다.

- [ ] **Step 1: 개발 서버 기동**

Run: `npm run dev`

- [ ] **Step 2: 정산담당자(SETTLEMENT 또는 ADMIN)로 로그인 후 `/expenses?tab=payment-request` 확인**

체크리스트:
- [ ] 상단 버튼 순서가 `📗 엑셀 다운로드 → ⬆ 엑셀 업로드 → 🗓️ 수정 → 🗑️ 삭제` 순서인지 확인.
- [ ] 관리 컬럼에 🔍가 아니라 ✏️/🗑️만 보이는지 확인.
- [ ] ✏️ 클릭 → 지급명의/고객사/사업자명/지급일/지급여부가 각각 드롭다운/콤보박스/날짜입력으로 바뀌는지 확인.
- [ ] 사업자명 콤보박스에서 다른 사업자를 선택하고 저장 → 목록에 새 사업자명이 반영되는지 확인.
- [ ] 지급완료 상태인 행도 ✏️로 수정 가능한지 확인.
- [ ] 체크박스 여러 개 선택 → "🗓️ 수정" 클릭 → 팝업에서 지급일 달력 + 지급여부 드롭다운으로 적용 → 선택된 건 모두 반영되는지 확인.
- [ ] 행별 🗑️ 클릭 → 확인 모달 → 삭제 → 목록에서 사라지는지 확인.
- [ ] 체크박스 여러 개 선택 → 상단 "🗑️ 삭제" → 확인 모달 → 일괄 삭제되는지 확인(지급완료 건 포함해도 되는지 확인).

- [ ] **Step 3: PM으로 로그인 후 동일 화면 확인**

체크리스트:
- [ ] 관리 컬럼 아이콘이 🔍가 아니라 ✏️(지급리스트와 동일 이모지)인지 확인.
- [ ] 본인이 신청한 지급준비 건의 ✏️ 클릭 → 등록 시 작성한 항목(지급명의/고객사/사업자명/단가/교통비/재료비/횟수/상세내역)이 모두 수정 가능한 입력으로 나오는지, 저장 후 반영되는지 확인. 지급일/지급여부는 읽기전용인지 확인.
- [ ] 본인이 신청한 지급완료 건, 또는 타인이 신청한 건은 ✏️ 클릭 시 읽기전용으로만 보이고 저장 버튼이 없는지 확인.
- [ ] 지급준비+본인 건은 체크박스/행별 🗑️가 활성화되어 삭제 가능한지 확인.
- [ ] 지급완료 건 또는 타인 신청 건은 체크박스/🗑️가 비활성화(회색, 클릭 불가)로 보이는지 확인.
- [ ] "전체선택" 체크박스를 눌러도 비활성 대상 행은 선택되지 않는지 확인.

- [ ] **Step 4: 문제 발견 시**

발견된 문제를 기록하고 해당 Task로 돌아가 수정 후 이 Task를 다시 수행한다. 문제가 없으면 계획 완료.

---

## Self-Review 체크리스트 (계획 작성자용, 이미 반영됨)

1. **스펙 커버리지:** 설계 문서(`docs/superpowers/specs/2026-08-04-payment-request-edit-delete-design.md`)의 모든 섹션(1 정산담당자, 2 PM, 공통 삭제, 데이터/서버 액션 구조, 권한 요약, 에러 처리, 테스트)이 Task 1~9에 매핑됨.
2. **플레이스홀더 스캔:** "TBD/추후 구현" 문구 없음 — 기존 `alert(NOT_IMPLEMENTED)` 자리표시자는 Task 6·7·8에서 전부 실제 로직으로 대체됨.
3. **타입 일관성:** `PaymentRequestRow`(데이터 타입, Task 1에서 `payeeId` 추가) ↔ `PaymentRequestRowData`(별칭, Task 5·8에서 사용) ↔ `PaymentRequestRow`(신규 컴포넌트, Task 5) 이름 충돌은 Payee의 기존 컨벤션(`PayeeRow` 타입 별칭 `PayeeRowData`)과 동일하게 별칭 처리로 해결함.
