# ROI 대시보드 Phase 1 — 기반(Foundation) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** @huno.kr Google 로그인 → 관리자 승인/역할부여 → 역할 기반 접근이 동작하고, PM의 "본인 담당 고객사만" 접근이 PostgreSQL RLS로 강제되는, 배포 가능한 인증·데이터 기반을 만든다.

**Architecture:** Next.js(App Router) 풀스택 단일 코드베이스. Prisma ORM + PostgreSQL. 인증은 Auth.js(NextAuth v5) + Google OAuth로 `@huno.kr` 도메인만 허용. 인가는 (1) 앱 레이어 가드 + (2) PostgreSQL Row-Level Security 이중 방어. RLS는 요청마다 트랜잭션 내에서 `set_config`로 사용자 컨텍스트를 주입하는 `withRLS` 헬퍼로 강제한다.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS v4, Prisma 6, PostgreSQL 16, Auth.js(NextAuth) 5, Vitest 3.

## Global Constraints

- **Node.js:** 20 LTS 이상. `package.json`의 `engines.node`를 `>=20` 으로 고정.
- **패키지 매니저:** `npm` (lockfile: `package-lock.json`).
- **DB 접속 역할:** 앱은 **비-슈퍼유저** 역할 `roi_app`(NOSUPERUSER, NOBYPASSRLS)로 접속한다. 슈퍼유저/BYPASSRLS 역할은 RLS를 우회하므로 앱·테스트 모두 `roi_app`을 사용한다.
- **역할 위계:** `ADMIN > SETTLEMENT > PM`. Prisma enum `Role = { ADMIN, SETTLEMENT, PM }`.
- **사용자 상태:** Prisma enum `UserStatus = { PENDING, ACTIVE, INACTIVE }`. 신규 로그인 사용자는 항상 `PENDING`(승인대기)·`role=null`. UI 한글 라벨: PENDING=승인대기, ACTIVE=활성, INACTIVE=비활성.
- **허용 도메인:** `@huno.kr` 만. OAuth `hd=huno.kr` 힌트 + **서버 측 이메일 도메인 재검증**(힌트는 신뢰하지 않음).
- **금액:** 모든 금액 컬럼은 `Int`(원 단위, 부가세 포함). 부가세 계산은 Phase 1 범위 밖.
- **없음(null) vs 0:** 계약금·청구액·입금액은 "없음"을 `null`, "0원"을 `0`으로 구분한다.
- **테스트:** 모든 태스크는 Vitest로 검증한다. DB가 필요한 테스트는 `.env.test`의 `DATABASE_URL`(로컬 PostgreSQL, `roi_app` 역할)을 사용한다.
- **커밋:** 태스크의 각 논리 단위마다 커밋. 커밋 메시지는 Conventional Commits.
- **git:** 이 디렉터리는 아직 git 저장소가 아니다. Task 1에서 `git init` 한다.

---

## File Structure

기반 단계에서 생성/수정하는 파일과 책임:

- `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example` — 프로젝트 설정.
- `vitest.config.ts`, `vitest.setup.ts`, `test/global-setup.ts` — 테스트 러너 및 DB 초기화.
- `src/lib/design/tokens.ts` — 디자인 팔레트 상수(단일 출처).
- `src/app/globals.css`, `tailwind.config.ts` — Tailwind 테마(토큰 연결).
- `prisma/schema.prisma` — 데이터 모델 전체(enum + 8개 엔티티).
- `prisma/migrations/**` — 스키마 마이그레이션 + RLS 정책 마이그레이션(수기 SQL).
- `src/lib/db.ts` — Prisma 클라이언트 싱글턴.
- `src/lib/rls.ts` — `withRLS` 트랜잭션 헬퍼(요청별 사용자 컨텍스트 주입).
- `src/lib/auth/domain.ts` — 도메인 허용 검증(순수 함수).
- `src/lib/auth/rbac.ts` — 역할 위계·권한 판정(순수 함수).
- `src/lib/auth/config.ts` — Auth.js 설정(providers, callbacks, adapter).
- `src/lib/auth/index.ts` — `auth()`, `signIn`, `signOut`, `handlers` export.
- `src/app/api/auth/[...nextauth]/route.ts` — Auth.js 라우트 핸들러.
- `src/middleware.ts` — 라우트 보호(미인증/승인대기 리다이렉트).
- `src/lib/auth/session.ts` — 서버 컴포넌트/액션용 세션 가드(`requireUser`, `requireRole`).
- `src/app/(auth)/login/page.tsx`, `src/app/(auth)/pending/page.tsx` — 로그인·승인대기 안내 화면.
- `src/app/admin/users/page.tsx`, `src/app/admin/users/actions.ts` — 관리자 사용자 승인/역할부여.
- `src/lib/labels.ts` — enum → 한글 라벨 매핑.

---

## Task 1: 프로젝트 스캐폴딩 (Next.js + TS + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.example`
- Create: `vitest.config.ts`, `src/lib/smoke.ts`, `test/smoke.test.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces:**
- Consumes: 없음(최초 태스크).
- Produces: 동작하는 Next.js 앱과 Vitest 러너. 후속 태스크는 `npm run test`, `npm run build`, `npm run dev`가 존재한다고 가정한다.

- [ ] **Step 1: git 초기화 및 Next.js 앱 생성**

Run:
```bash
git init
npx create-next-app@latest . --typescript --app --tailwind --eslint --src-dir --import-alias "@/*" --use-npm --no-turbopack
```
프롬프트가 뜨면 위 플래그와 동일하게(기본값) 선택. 기존 `CLAUDE.md`/`docs/`는 덮어쓰지 않도록 "디렉터리가 비어있지 않음" 경고가 나오면 계속 진행(y).

- [ ] **Step 2: Node 버전 고정 및 Vitest 의존성 추가**

`package.json`에 `engines`를 추가하고 테스트 의존성을 설치.
```bash
npm pkg set engines.node=">=20"
npm install -D vitest @vitejs/plugin-react
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
```

- [ ] **Step 3: Vitest 설정 작성**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: 스모크 테스트 작성 (실패 확인용)**

Create `test/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { add } from "@/lib/smoke";

describe("smoke", () => {
  it("adds numbers", () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

- [ ] **Step 5: 테스트 실행 → 실패 확인**

Run: `npm run test`
Expected: FAIL — `Cannot find module '@/lib/smoke'`.

- [ ] **Step 6: 최소 구현**

Create `src/lib/smoke.ts`:
```ts
export function add(a: number, b: number): number {
  return a + b;
}
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

Run: `npm run test`
Expected: PASS (1 passed).

- [ ] **Step 8: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(에러 없이 종료).

- [ ] **Step 9: .gitignore 및 .env.example 정리**

`.gitignore`에 다음이 포함되어 있는지 확인하고 없으면 추가: `.env`, `.env.local`, `.env.test`, `node_modules`, `.next`.

Create `.env.example`:
```bash
# App DB 접속 (비-슈퍼유저 roi_app 역할)
DATABASE_URL="postgresql://roi_app:roi_app_pw@localhost:5432/roi?schema=public"

# Auth.js
AUTH_SECRET="generate-with: npx auth secret"
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# 허용 도메인
ALLOWED_EMAIL_DOMAIN="huno.kr"
```

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest"
```

---

## Task 2: 디자인 토큰

**Files:**
- Create: `src/lib/design/tokens.ts`, `test/tokens.test.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 1의 앱.
- Produces: `tokens` 객체(팔레트 단일 출처)와 CSS 변수. 후속 UI 태스크는 `tokens` import와 `bg-surface`/`text-fg` 류 CSS 변수를 사용한다.

- [ ] **Step 1: 토큰 테스트 작성 (실패 확인용)**

Create `test/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokens } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("exposes the spec palette", () => {
    expect(tokens.color.bg).toBe("#F7F9FC");
    expect(tokens.color.surface).toBe("#FFFFFF");
    expect(tokens.color.primary).toBe("#2563EB");
    expect(tokens.color.fg).toBe("#0F172A");
    expect(tokens.color.muted).toBe("#64748B");
    expect(tokens.color.border).toBe("#E8EDF4");
    expect(tokens.color.success).toBe("#10B981");
    expect(tokens.color.danger).toBe("#F43F5E");
    expect(tokens.radius.card).toBe("14px");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- tokens`
Expected: FAIL — `Cannot find module '@/lib/design/tokens'`.

- [ ] **Step 3: 토큰 모듈 구현**

Create `src/lib/design/tokens.ts`:
```ts
export const tokens = {
  color: {
    bg: "#F7F9FC",
    surface: "#FFFFFF",
    primary: "#2563EB",
    fg: "#0F172A",
    muted: "#64748B",
    border: "#E8EDF4",
    success: "#10B981",
    danger: "#F43F5E",
    sidebar: "#0F172A",
  },
  radius: {
    card: "14px",
  },
} as const;
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- tokens`
Expected: PASS.

- [ ] **Step 5: CSS 변수 연결**

`src/app/globals.css` 상단에 아래 변수 블록을 추가(Tailwind v4의 `@import "tailwindcss";` 아래):
```css
:root {
  --color-bg: #F7F9FC;
  --color-surface: #FFFFFF;
  --color-primary: #2563EB;
  --color-fg: #0F172A;
  --color-muted: #64748B;
  --color-border: #E8EDF4;
  --color-success: #10B981;
  --color-danger: #F43F5E;
  --color-sidebar: #0F172A;
  --radius-card: 14px;
}

body {
  background: var(--color-bg);
  color: var(--color-fg);
}
```

- [ ] **Step 6: 빌드 확인 및 커밋**

Run: `npm run build`
Expected: 성공.
```bash
git add -A
git commit -m "feat: add design tokens and base theme"
```

---

## Task 3: Prisma 스키마 + 최초 마이그레이션

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`
- Create: `.env.test`, `test/db.test.ts`, `test/global-setup.ts`
- Modify: `vitest.config.ts`, `package.json`

**Interfaces:**
- Consumes: Task 1의 앱.
- Produces:
  - `prisma` 클라이언트 싱글턴: `import { prisma } from "@/lib/db"`.
  - Prisma 모델: `User, Client, Task, MonthlyPerformance, MonthlyBilling, MonthlyDeposit, Expense`.
  - enums: `Role{ADMIN,SETTLEMENT,PM}`, `UserStatus{PENDING,ACTIVE,INACTIVE}`, `TaskSource{MANUAL,PDF}`, `ExpenseCategory{CORPORATE_CARD,PERSONAL_CARD,COUNSELING_FEE,INSTRUCTOR_FEE,PROMOTION,ETC}`.
  - 후속 태스크는 이 모델·필드명(`pmId`, `clientId`, `taskId`, `unitPrice`, `contractAmount`, `year`, `month`, `count`, `amount` 등)을 그대로 사용한다.

- [ ] **Step 1: PostgreSQL 앱 역할·DB (이미 생성됨 — 검증만)**

환경 준비 단계에서 **이미 완료**되었다. 이 머신에서는 포터블 PostgreSQL 16.8 클러스터가 **포트 5433**에서 실행 중이며(기본 5432는 다른 설치가 점유), 다음이 생성되어 있다:
- 역할 `roi_app`: `LOGIN`, 비밀번호 `roi_app_pw`, **NOSUPERUSER, CREATEDB, NOBYPASSRLS**. (CREATEDB는 `prisma migrate dev`의 shadow DB 생성에 필요. RLS 우회와 무관 — 우회 차단은 NOSUPERUSER+NOBYPASSRLS가 담당.)
- DB `roi`, `roi_test`: 소유자 `roi_app`.
- 인증: 로컬 `trust` (dev 전용).

psql 경로: `C:\dev\pgsql\bin\psql.exe`. 서버 재시작이 필요하면: `C:\dev\pgsql\bin\pg_ctl.exe -D C:\dev\pgdata -o "-p 5433" start`.

> 검증(그대로 실행): `& "C:\dev\pgsql\bin\psql.exe" -U roi_app -h localhost -p 5433 -d roi -c "select current_user, current_database();"` → `roi_app | roi` 반환.

- [ ] **Step 2: Prisma 설치 및 초기화**

```bash
npm install -D prisma@^6
npm install @prisma/client@^6
npx prisma init --datasource-provider postgresql
```
> Prisma는 **6.x로 고정**한다. Prisma 7은 새 `prisma-client` 제너레이터(ESM, `src/generated/prisma`로 출력)와 드라이버 어댑터 등 파괴적 변경이 있어 본 계획(및 Task 4의 `$transaction`+`$executeRaw` RLS 패턴, `import { PrismaClient } from "@prisma/client"`)과 어긋난다. Prisma 7이 생성한 `prisma.config.ts`와 `.gitignore`의 `/src/generated/prisma` 항목이 있으면 제거하고, 스키마의 `generator client { provider = "prisma-client-js" }`(클래식 `@prisma/client` 출력)를 사용한다. v6는 config 파일 없이 `.env`를 자동 로드한다.
이후 `.env`(로컬 실개발)와 `.env.test`(테스트)에 `DATABASE_URL`을 `roi_app` 역할·**포트 5433**으로 설정:
```bash
# .env
DATABASE_URL="postgresql://roi_app:roi_app_pw@localhost:5433/roi?schema=public"
```
Create `.env.test`:
```bash
DATABASE_URL="postgresql://roi_app:roi_app_pw@localhost:5433/roi_test?schema=public"
ALLOWED_EMAIL_DOMAIN="huno.kr"
```
> 주의: `prisma init`이 덮어쓴 `.env`의 기본 `DATABASE_URL`을 위 값(포트 5433)으로 교체할 것. 포트는 5432가 아니라 **5433**이다.

- [ ] **Step 2b: schema.prisma의 관계 무결성 강제 옵션 설정**

RLS가 PM 접근을 막을 때 FK 참조 검사가 RLS를 우회하지 않도록, 애플리케이션 레벨에서 관계를 관리한다. `prisma/schema.prisma`의 generator에 preview가 필요 없으므로 기본값 유지. (참고: FK 자체는 유지하되, PM은 자식 테이블만 접근하고 부모 FK 검증은 INSERT 시점에만 발생.)

- [ ] **Step 3: 스키마 작성**

Replace `prisma/schema.prisma` with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  SETTLEMENT
  PM
}

enum UserStatus {
  PENDING
  ACTIVE
  INACTIVE
}

enum TaskSource {
  MANUAL
  PDF
}

enum ExpenseCategory {
  CORPORATE_CARD
  PERSONAL_CARD
  COUNSELING_FEE
  INSTRUCTOR_FEE
  PROMOTION
  ETC
}

model User {
  id        String     @id @default(cuid())
  email     String     @unique
  name      String?
  image     String?
  role      Role?
  status    UserStatus @default(PENDING)
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  managedClients Client[] @relation("ClientPM")
  accounts  Account[]
  sessions  Session[]

  @@index([role])
  @@index([status])
}

model Client {
  id           String   @id @default(cuid())
  name         String
  status       String   @default("진행중")
  contractStart DateTime?
  contractEnd   DateTime?
  pmId         String?
  pm           User?    @relation("ClientPM", fields: [pmId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tasks        Task[]
  billings     MonthlyBilling[]
  deposits     MonthlyDeposit[]
  expenses     Expense[]

  @@index([pmId])
}

model Task {
  id             String     @id @default(cuid())
  clientId       String
  client         Client     @relation(fields: [clientId], references: [id], onDelete: Cascade)
  name           String
  unitPrice      Int
  contractAmount Int?
  source         TaskSource @default(MANUAL)
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  performances   MonthlyPerformance[]

  @@index([clientId])
}

model MonthlyPerformance {
  id        String   @id @default(cuid())
  taskId    String
  task      Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  year      Int
  month     Int
  count     Int
  amount    Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([taskId, year, month])
  @@index([year, month])
}

model MonthlyBilling {
  id        String   @id @default(cuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  year      Int
  month     Int
  amount    Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, year, month])
  @@index([year, month])
}

model MonthlyDeposit {
  id        String   @id @default(cuid())
  clientId  String
  client    Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  year      Int
  month     Int
  amount    Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([clientId, year, month])
  @@index([year, month])
}

model Expense {
  id        String          @id @default(cuid())
  clientId  String
  client    Client          @relation(fields: [clientId], references: [id], onDelete: Cascade)
  year      Int
  month     Int
  category  ExpenseCategory
  amount    Int
  memo      String?
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@index([clientId, year, month])
}

// --- Auth.js (NextAuth) 어댑터 모델 ---
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 4: 마이그레이션 검증 및 생성**

```bash
npx prisma validate
npx prisma migrate dev --name init
```
Expected: `prisma/migrations/<timestamp>_init/migration.sql` 생성, `roi` DB에 적용, 클라이언트 생성.

- [ ] **Step 5: Prisma 클라이언트 싱글턴 작성**

Create `src/lib/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 6: 테스트 DB 초기화 셋업 작성**

Create `test/global-setup.ts`:
```ts
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
```

`vitest.config.ts`의 `test` 블록에 다음을 추가:
```ts
    globalSetup: ["./test/global-setup.ts"],
    env: loadEnvTest(),
```
그리고 파일 상단에 헬퍼를 추가:
```ts
import { config as loadDotenv } from "dotenv";
function loadEnvTest(): Record<string, string> {
  const parsed = loadDotenv({ path: ".env.test" }).parsed ?? {};
  return parsed;
}
```
`dotenv` 설치:
```bash
npm install -D dotenv
```

- [ ] **Step 7: DB 연결 테스트 작성 (실패 확인용)**

Create `test/db.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/db";

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe("prisma connection", () => {
  it("creates and reads a user with PENDING default status", async () => {
    const user = await prisma.user.create({
      data: { email: "a@huno.kr", name: "A" },
    });
    expect(user.status).toBe("PENDING");
    expect(user.role).toBeNull();

    const found = await prisma.user.findUnique({ where: { email: "a@huno.kr" } });
    expect(found?.id).toBe(user.id);
  });
});
```

- [ ] **Step 8: 테스트 실행 → 통과 확인**

Run: `npm run test -- db`
Expected: PASS (스키마·기본값·연결 검증).

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: add Prisma schema, migration, and db client"
```

---

## Task 4: RLS 정책 + withRLS 헬퍼

**Files:**
- Create: `prisma/migrations/<timestamp>_rls/migration.sql` (수기)
- Create: `src/lib/rls.ts`, `test/rls.test.ts`

**Interfaces:**
- Consumes: Task 3의 모델(`Client.pmId` 등), `prisma`.
- Produces:
  - `withRLS<T>(ctx: { userId: string; role: "ADMIN" | "SETTLEMENT" | "PM" }, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` — 요청별 사용자 컨텍스트를 주입한 트랜잭션. 데이터 접근이 필요한 후속 태스크(Plan 2·3)는 반드시 이 헬퍼 안에서 쿼리한다.
  - PostgreSQL RLS 정책: ADMIN/SETTLEMENT 전체, PM은 자신이 담당(`pmId`)인 Client 및 그 하위(Task/Performance/Billing/Deposit/Expense)만.

- [ ] **Step 1: RLS 마이그레이션 골격 생성**

```bash
npx prisma migrate dev --create-only --name rls
```
`prisma/migrations/<timestamp>_rls/migration.sql`가 빈 파일로 생성된다.

- [ ] **Step 2: RLS 정책 SQL 작성**

위 `migration.sql`에 아래 내용을 작성:
```sql
-- 사용자 컨텍스트 헬퍼: 세션 변수에서 값 읽기 (없으면 빈 문자열)
-- app.user_id / app.user_role 는 withRLS 가 트랜잭션마다 set_config 로 주입.

-- Client
ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
CREATE POLICY client_rls ON "Client"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR "pmId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR "pmId" = current_setting('app.user_id', true)
  );

-- Task (Client 경유)
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_rls ON "Task"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Client" c
      WHERE c.id = "Task"."clientId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Client" c
      WHERE c.id = "Task"."clientId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  );

-- MonthlyPerformance (Task → Client 경유)
ALTER TABLE "MonthlyPerformance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyPerformance" FORCE ROW LEVEL SECURITY;
CREATE POLICY perf_rls ON "MonthlyPerformance"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "Client" c ON c.id = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (
      SELECT 1 FROM "Task" t
      JOIN "Client" c ON c.id = t."clientId"
      WHERE t.id = "MonthlyPerformance"."taskId"
        AND c."pmId" = current_setting('app.user_id', true)
    )
  );

-- MonthlyBilling (Client 경유)
ALTER TABLE "MonthlyBilling" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyBilling" FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_rls ON "MonthlyBilling"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyBilling"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyBilling"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );

-- MonthlyDeposit (Client 경유)
ALTER TABLE "MonthlyDeposit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyDeposit" FORCE ROW LEVEL SECURITY;
CREATE POLICY deposit_rls ON "MonthlyDeposit"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyDeposit"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "MonthlyDeposit"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );

-- Expense (Client 경유)
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_rls ON "Expense"
  USING (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Expense"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.user_role', true) IN ('ADMIN', 'SETTLEMENT')
    OR EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Expense"."clientId" AND c."pmId" = current_setting('app.user_id', true))
  );
```

> 주의: `User`, `Account`, `Session`은 RLS를 걸지 않는다(인증·사용자관리는 앱 가드로 통제, 로그인 시점엔 세션 컨텍스트가 없음).

- [ ] **Step 3: 마이그레이션 적용**

```bash
npx prisma migrate dev
```
Expected: `roi` DB에 RLS 정책 적용.

- [ ] **Step 4: withRLS 헬퍼 작성**

Create `src/lib/rls.ts`:
```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RlsContext = {
  userId: string;
  role: "ADMIN" | "SETTLEMENT" | "PM";
};

/**
 * 요청별 사용자 컨텍스트를 주입한 트랜잭션.
 * set_config(..., true) = SET LOCAL → 트랜잭션 종료 시 자동 초기화되어
 * 커넥션 풀 재사용 시 컨텍스트가 누출되지 않는다.
 */
export function withRLS<T>(
  ctx: RlsContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.user_role', ${ctx.role}, true)`;
    return fn(tx);
  });
}
```

- [ ] **Step 5: RLS 테스트 작성 (실패 확인용)**

Create `test/rls.test.ts`:

> 중요: `FORCE ROW LEVEL SECURITY`는 테이블 소유자(`roi_app`)에게도 적용된다. 따라서 세션 컨텍스트 없이 bare `prisma.client.create/deleteMany`를 호출하면 정책(USING/WITH CHECK)이 거짓으로 평가되어 **쓰기·삭제가 차단**된다. 시드·정리는 정책을 무조건 통과하는 **ADMIN 컨텍스트(`withRLS`)** 안에서 수행한다. `User`는 RLS 미적용이라 bare로 시드해도 된다.

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { withRLS } from "@/lib/rls";

// ADMIN 컨텍스트: 정책상 모든 행 접근 허용 → 시드/정리에 사용.
const ADMIN = { userId: "seed-admin", role: "ADMIN" as const };

async function reset() {
  await withRLS(ADMIN, async (tx) => {
    await tx.expense.deleteMany();
    await tx.monthlyDeposit.deleteMany();
    await tx.monthlyBilling.deleteMany();
    await tx.monthlyPerformance.deleteMany();
    await tx.task.deleteMany();
    await tx.client.deleteMany();
  });
  await prisma.user.deleteMany(); // User는 RLS 미적용
}

describe("RLS: PM sees only own clients", () => {
  let pmA: string;
  let pmB: string;
  let clientA: string;
  let clientB: string;
  let taskA: string;

  beforeEach(async () => {
    await reset();
    const a = await prisma.user.create({ data: { email: "pma@huno.kr", role: "PM", status: "ACTIVE" } });
    const b = await prisma.user.create({ data: { email: "pmb@huno.kr", role: "PM", status: "ACTIVE" } });
    pmA = a.id;
    pmB = b.id;
    await withRLS(ADMIN, async (tx) => {
      clientA = (await tx.client.create({ data: { name: "A사", pmId: pmA } })).id;
      clientB = (await tx.client.create({ data: { name: "B사", pmId: pmB } })).id;
      taskA = (await tx.task.create({ data: { clientId: clientA, name: "심리진단", unitPrice: 10000 } })).id;
      await tx.task.create({ data: { clientId: clientB, name: "전문가상담", unitPrice: 20000 } });
    });
  });

  it("PM A reads only client A", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.client.findMany());
    expect(rows.map((r) => r.id)).toEqual([clientA]);
  });

  it("PM A reads only tasks under client A (child-table policy)", async () => {
    const rows = await withRLS({ userId: pmA, role: "PM" }, (tx) => tx.task.findMany());
    expect(rows.map((r) => r.id)).toEqual([taskA]);
  });

  it("ADMIN reads all clients", async () => {
    const rows = await withRLS({ userId: pmA, role: "ADMIN" }, (tx) => tx.client.findMany());
    expect(rows.length).toBe(2);
  });

  it("PM A cannot update client B", async () => {
    const result = await withRLS({ userId: pmA, role: "PM" }, (tx) =>
      tx.client.updateMany({ where: { id: clientB }, data: { name: "해킹" } }),
    );
    expect(result.count).toBe(0);
  });
});
```

- [ ] **Step 6: 테스트 실행 → 통과 확인**

Run: `npm run test -- rls`
Expected: PASS (4 passed). 만약 ADMIN 케이스가 실패하고 PM 케이스도 전부 통과하면, 앱이 슈퍼유저로 접속 중일 가능성 → `.env.test`의 `DATABASE_URL`이 `roi_app` 인지 확인. 만약 시드(`beforeEach`)에서 `new row violates row-level security policy` 오류가 나면 `FORCE` RLS가 적용된 것이므로 시드가 ADMIN 컨텍스트 안에 있는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: enforce PM row-level security via Postgres RLS + withRLS helper"
```

---

## Task 5: 인증 순수 함수 (도메인 검증 + RBAC)

**Files:**
- Create: `src/lib/auth/domain.ts`, `src/lib/auth/rbac.ts`
- Create: `test/domain.test.ts`, `test/rbac.test.ts`

**Interfaces:**
- Consumes: Global Constraints의 역할 위계·허용 도메인.
- Produces:
  - `isAllowedEmail(email: string | null | undefined, domain: string): boolean`
  - `type AppRole = "ADMIN" | "SETTLEMENT" | "PM"`
  - `hasAtLeast(role: AppRole | null | undefined, required: AppRole): boolean` — 위계 기반 판정(ADMIN이 SETTLEMENT/PM 권한 포함).
  - `canManageUsers(role): boolean` (ADMIN만), `canEditSettlement(role): boolean` (ADMIN/SETTLEMENT).

- [ ] **Step 1: 도메인 검증 테스트 작성 (실패 확인용)**

Create `test/domain.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "@/lib/auth/domain";

describe("isAllowedEmail", () => {
  it("accepts @huno.kr", () => {
    expect(isAllowedEmail("shryu@huno.kr", "huno.kr")).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isAllowedEmail("x@gmail.com", "huno.kr")).toBe(false);
  });
  it("rejects lookalike domains", () => {
    expect(isAllowedEmail("x@evilhuno.kr", "huno.kr")).toBe(false);
    expect(isAllowedEmail("x@huno.kr.evil.com", "huno.kr")).toBe(false);
  });
  it("rejects empty/null", () => {
    expect(isAllowedEmail(null, "huno.kr")).toBe(false);
    expect(isAllowedEmail("", "huno.kr")).toBe(false);
  });
  it("is case-insensitive on domain", () => {
    expect(isAllowedEmail("A@HUNO.KR", "huno.kr")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- domain`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 도메인 검증 구현**

Create `src/lib/auth/domain.ts`:
```ts
export function isAllowedEmail(
  email: string | null | undefined,
  domain: string,
): boolean {
  if (!email) return false;
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2) return false;
  return parts[1] === domain.toLowerCase();
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- domain`
Expected: PASS.

- [ ] **Step 5: RBAC 테스트 작성 (실패 확인용)**

Create `test/rbac.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hasAtLeast, canManageUsers, canEditSettlement } from "@/lib/auth/rbac";

describe("hasAtLeast (hierarchy ADMIN > SETTLEMENT > PM)", () => {
  it("ADMIN satisfies every requirement", () => {
    expect(hasAtLeast("ADMIN", "PM")).toBe(true);
    expect(hasAtLeast("ADMIN", "SETTLEMENT")).toBe(true);
    expect(hasAtLeast("ADMIN", "ADMIN")).toBe(true);
  });
  it("PM does not satisfy SETTLEMENT/ADMIN", () => {
    expect(hasAtLeast("PM", "SETTLEMENT")).toBe(false);
    expect(hasAtLeast("PM", "ADMIN")).toBe(false);
    expect(hasAtLeast("PM", "PM")).toBe(true);
  });
  it("null role satisfies nothing", () => {
    expect(hasAtLeast(null, "PM")).toBe(false);
  });
});

describe("permission predicates", () => {
  it("only ADMIN manages users", () => {
    expect(canManageUsers("ADMIN")).toBe(true);
    expect(canManageUsers("SETTLEMENT")).toBe(false);
    expect(canManageUsers("PM")).toBe(false);
  });
  it("ADMIN and SETTLEMENT edit settlement data", () => {
    expect(canEditSettlement("ADMIN")).toBe(true);
    expect(canEditSettlement("SETTLEMENT")).toBe(true);
    expect(canEditSettlement("PM")).toBe(false);
  });
});
```

- [ ] **Step 6: 테스트 실행 → 실패 확인**

Run: `npm run test -- rbac`
Expected: FAIL — 모듈 없음.

- [ ] **Step 7: RBAC 구현**

Create `src/lib/auth/rbac.ts`:
```ts
export type AppRole = "ADMIN" | "SETTLEMENT" | "PM";

const RANK: Record<AppRole, number> = { ADMIN: 3, SETTLEMENT: 2, PM: 1 };

export function hasAtLeast(
  role: AppRole | null | undefined,
  required: AppRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[required];
}

export function canManageUsers(role: AppRole | null | undefined): boolean {
  return role === "ADMIN";
}

export function canEditSettlement(role: AppRole | null | undefined): boolean {
  return hasAtLeast(role, "SETTLEMENT");
}
```

- [ ] **Step 8: 테스트 실행 → 통과 확인**

Run: `npm run test -- rbac`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: add auth domain check and RBAC predicates"
```

---

## Task 6: Auth.js 구성 (Google OAuth + 프로비저닝)

**Files:**
- Create: `src/lib/auth/config.ts`, `src/lib/auth/index.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `test/auth-callbacks.test.ts`
- Modify: `src/lib/db.ts` 사용(어댑터)

**Interfaces:**
- Consumes: `isAllowedEmail` (Task 5), `prisma` (Task 3), enums.
- Produces:
  - `signInCallback(params): Promise<boolean>` — `@huno.kr`가 아니면 `false`(로그인 거부).
  - `sessionCallback(params)` — 세션에 `user.id`, `user.role`, `user.status` 부착.
  - `auth`, `signIn`, `signOut`, `handlers` (`src/lib/auth/index.ts`).
  - 세션 타입 확장: `session.user.role: AppRole | null`, `session.user.status: "PENDING"|"ACTIVE"|"INACTIVE"`, `session.user.id: string`.
  - 후속 태스크는 `import { auth } from "@/lib/auth"`로 세션을 읽는다.

- [ ] **Step 1: 의존성 설치**

```bash
npm install next-auth@beta @auth/prisma-adapter
```

- [ ] **Step 2: 콜백 순수 로직 테스트 작성 (실패 확인용)**

`signIn` 콜백을 테스트 가능한 함수로 분리한다. Create `test/auth-callbacks.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signInCallback } from "@/lib/auth/config";

function makeParams(email: string | null) {
  return { user: { email } } as Parameters<typeof signInCallback>[0];
}

describe("signInCallback", () => {
  it("allows @huno.kr", async () => {
    expect(await signInCallback(makeParams("a@huno.kr"))).toBe(true);
  });
  it("blocks non-huno.kr", async () => {
    expect(await signInCallback(makeParams("a@gmail.com"))).toBe(false);
  });
  it("blocks missing email", async () => {
    expect(await signInCallback(makeParams(null))).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npm run test -- auth-callbacks`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: Auth 설정 구현**

Create `src/lib/auth/config.ts`:
```ts
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { isAllowedEmail } from "@/lib/auth/domain";
import type { AppRole } from "@/lib/auth/rbac";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "huno.kr";

export async function signInCallback(params: {
  user: { email?: string | null };
}): Promise<boolean> {
  // 서버 측 도메인 재검증 (OAuth hd 힌트는 신뢰하지 않음)
  return isAllowedEmail(params.user.email, ALLOWED_DOMAIN);
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Google({
      authorization: {
        params: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    signIn: signInCallback,
    async session({ session, user }) {
      // 어댑터의 DB user에서 role/status를 세션에 부착
      session.user.id = user.id;
      session.user.role = (user as { role: AppRole | null }).role ?? null;
      session.user.status = (user as { status: "PENDING" | "ACTIVE" | "INACTIVE" }).status;
      return session;
    },
  },
};
```

- [ ] **Step 5: 세션 타입 확장 작성**

Create `src/types/next-auth.d.ts`:
```ts
import type { AppRole } from "@/lib/auth/rbac";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole | null;
      status: "PENDING" | "ACTIVE" | "INACTIVE";
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
```
`tsconfig.json`의 `include`에 `src/types/**/*.d.ts`가 포함되는지 확인(기본 `**/*.ts`면 자동 포함).

- [ ] **Step 6: Auth 진입점 및 라우트 핸들러 작성**

Create `src/lib/auth/index.ts`:
```ts
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

Create `src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 7: 테스트 실행 → 통과 확인**

Run: `npm run test -- auth-callbacks`
Expected: PASS.

- [ ] **Step 8: 타입·빌드 확인**

Run: `npm run build`
Expected: 성공(세션 타입 확장이 인식되어야 함). 실패 시 `next-auth.d.ts`의 모듈 경로·include 설정 확인.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: configure Auth.js with Google OAuth and huno.kr domain restriction"
```

---

## Task 7: 라우트 보호 미들웨어 + 서버 가드

**Files:**
- Create: `src/middleware.ts`, `src/lib/auth/session.ts`
- Create: `test/session-guard.test.ts`
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/pending/page.tsx`

**Interfaces:**
- Consumes: `auth` (Task 6), `hasAtLeast`/`AppRole` (Task 5).
- Produces:
  - `requireUser(): Promise<SessionUser>` — 미인증이면 `/login`, `PENDING`이면 `/pending`으로 redirect. 서버 컴포넌트/액션에서 사용.
  - `requireRole(required: AppRole): Promise<SessionUser>` — 권한 부족이면 `/`로 redirect 후 throw.
  - `type SessionUser = { id: string; role: AppRole | null; status: ...; email?: ... }`.
  - 미들웨어: 비공개 경로 미인증 접근 시 `/login` 리다이렉트.

- [ ] **Step 1: 세션 가드 테스트 작성 (실패 확인용)**

가드의 판정 로직을 순수 함수 `resolveGuard`로 분리해 리다이렉트 대상을 검증한다. Create `test/session-guard.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveGuard } from "@/lib/auth/session";

describe("resolveGuard", () => {
  it("redirects unauthenticated to /login", () => {
    expect(resolveGuard(null, null)).toEqual({ redirect: "/login" });
  });
  it("redirects PENDING to /pending", () => {
    expect(resolveGuard({ status: "PENDING", role: null }, null)).toEqual({ redirect: "/pending" });
  });
  it("redirects INACTIVE to /pending", () => {
    expect(resolveGuard({ status: "INACTIVE", role: "PM" }, null)).toEqual({ redirect: "/pending" });
  });
  it("allows ACTIVE user with no role requirement", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "PM" }, null)).toEqual({ ok: true });
  });
  it("blocks insufficient role", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "PM" }, "ADMIN")).toEqual({ redirect: "/" });
  });
  it("allows sufficient role", () => {
    expect(resolveGuard({ status: "ACTIVE", role: "ADMIN" }, "SETTLEMENT")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- session-guard`
Expected: FAIL — 모듈/함수 없음.

- [ ] **Step 3: 세션 가드 구현**

Create `src/lib/auth/session.ts`:
```ts
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasAtLeast, type AppRole } from "@/lib/auth/rbac";

export type SessionUser = {
  id: string;
  role: AppRole | null;
  status: "PENDING" | "ACTIVE" | "INACTIVE";
  email?: string | null;
  name?: string | null;
};

type GuardInput = { status: SessionUser["status"]; role: AppRole | null } | null;
type GuardResult = { ok: true } | { redirect: string };

/** 순수 판정 로직 (테스트 대상). */
export function resolveGuard(user: GuardInput, required: AppRole | null): GuardResult {
  if (!user) return { redirect: "/login" };
  if (user.status !== "ACTIVE") return { redirect: "/pending" };
  if (required && !hasAtLeast(user.role, required)) return { redirect: "/" };
  return { ok: true };
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, null);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}

export async function requireRole(required: AppRole): Promise<SessionUser> {
  const session = await auth();
  const user = (session?.user ?? null) as SessionUser | null;
  const result = resolveGuard(user, required);
  if ("redirect" in result) redirect(result.redirect);
  return user!;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- session-guard`
Expected: PASS.

- [ ] **Step 5: 미들웨어 작성**

> 중요: 데이터베이스 세션 전략에서는 미들웨어(Edge 런타임)에서 Prisma로 세션을 검증할 수 없다. 따라서 미들웨어는 **세션 쿠키 존재 여부만으로 미인증자를 빠르게 리다이렉트**하는 1차 관문이며, **실제 인가 강제는 서버 가드(`requireUser`/`requireRole`, Node 런타임) + RLS**가 담당한다. 쿠키가 있어도 서버 가드가 상태·역할을 재검증하므로 안전하다.

Create `src/middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";

// Auth.js v5 기본 세션 쿠키명 (https 배포 시 __Secure- 접두사)
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/pending") ||
    pathname.startsWith("/api/auth");
  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 6: 로그인·승인대기 화면 작성**

Create `src/app/(auth)/login/page.tsx`:
```tsx
import { signIn } from "@/lib/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-[14px] bg-[var(--color-primary)] px-6 py-3 text-white"
        >
          @huno.kr 계정으로 로그인
        </button>
      </form>
    </main>
  );
}
```

Create `src/app/(auth)/pending/page.tsx`:
```tsx
export default function PendingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-xl font-semibold">승인 대기 중</h1>
      <p className="text-[var(--color-muted)]">
        관리자가 계정을 승인하고 역할을 지정하면 대시보드를 이용할 수 있습니다.
      </p>
    </main>
  );
}
```

- [ ] **Step 7: 루트 페이지를 가드로 교체**

`src/app/page.tsx`(create-next-app 기본 스플래시)를 서버 가드가 걸린 최소 랜딩으로 교체. 미인증→`/login`, 승인대기/비활성→`/pending`으로 redirect되고, 활성 사용자만 통과한다(대시보드 본문은 Plan 3에서 구현).

Replace `src/app/page.tsx` with:
```tsx
import { requireUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">ROI 대시보드</h1>
      <p className="text-[var(--color-muted)]">{user.email}</p>
    </main>
  );
}
```

- [ ] **Step 8: 빌드 확인 및 커밋**

Run: `npm run build`
Expected: 성공.
```bash
git add -A
git commit -m "feat: add route protection middleware, server guards, and guarded root page"
```

---

## Task 8: 관리자 사용자 승인/역할부여

**Files:**
- Create: `src/lib/labels.ts`, `test/labels.test.ts`
- Create: `src/app/admin/users/actions.ts`, `test/user-admin-actions.test.ts`
- Create: `src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `requireRole` (Task 7), `prisma` (Task 3), `canManageUsers` (Task 5), enums, `withRLS` 불필요(User는 RLS 미적용).
- Produces:
  - `roleLabel(role)`, `statusLabel(status)`, `expenseCategoryLabel(cat)` — 한글 라벨.
  - `approveUser(input: { userId: string; role: AppRole }): Promise<{ ok: boolean; error?: string }>` — 상태를 `ACTIVE`로, `role` 지정. (server action; 내부에서 `requireRole("ADMIN")` 호출.)
  - `setUserStatus(input: { userId: string; status: "ACTIVE" | "INACTIVE" }): Promise<{ ok: boolean }>`.
  - 승인/역할부여가 반영된 관리자 화면(`/admin/users`).

- [ ] **Step 1: 라벨 테스트 작성 (실패 확인용)**

Create `test/labels.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { roleLabel, statusLabel, expenseCategoryLabel } from "@/lib/labels";

describe("labels", () => {
  it("maps roles to Korean", () => {
    expect(roleLabel("ADMIN")).toBe("관리자");
    expect(roleLabel("SETTLEMENT")).toBe("정산담당자");
    expect(roleLabel("PM")).toBe("PM");
    expect(roleLabel(null)).toBe("미지정");
  });
  it("maps status to Korean", () => {
    expect(statusLabel("PENDING")).toBe("승인대기");
    expect(statusLabel("ACTIVE")).toBe("활성");
    expect(statusLabel("INACTIVE")).toBe("비활성");
  });
  it("maps expense categories to Korean", () => {
    expect(expenseCategoryLabel("CORPORATE_CARD")).toBe("법인카드");
    expect(expenseCategoryLabel("PERSONAL_CARD")).toBe("개인카드");
    expect(expenseCategoryLabel("COUNSELING_FEE")).toBe("상담료");
    expect(expenseCategoryLabel("INSTRUCTOR_FEE")).toBe("강사료");
    expect(expenseCategoryLabel("PROMOTION")).toBe("홍보비용");
    expect(expenseCategoryLabel("ETC")).toBe("기타");
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test -- labels`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 라벨 구현**

Create `src/lib/labels.ts`:
```ts
import type { AppRole } from "@/lib/auth/rbac";

export function roleLabel(role: AppRole | null | undefined): string {
  switch (role) {
    case "ADMIN": return "관리자";
    case "SETTLEMENT": return "정산담당자";
    case "PM": return "PM";
    default: return "미지정";
  }
}

export function statusLabel(status: "PENDING" | "ACTIVE" | "INACTIVE"): string {
  switch (status) {
    case "PENDING": return "승인대기";
    case "ACTIVE": return "활성";
    case "INACTIVE": return "비활성";
  }
}

export function expenseCategoryLabel(
  cat: "CORPORATE_CARD" | "PERSONAL_CARD" | "COUNSELING_FEE" | "INSTRUCTOR_FEE" | "PROMOTION" | "ETC",
): string {
  switch (cat) {
    case "CORPORATE_CARD": return "법인카드";
    case "PERSONAL_CARD": return "개인카드";
    case "COUNSELING_FEE": return "상담료";
    case "INSTRUCTOR_FEE": return "강사료";
    case "PROMOTION": return "홍보비용";
    case "ETC": return "기타";
  }
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test -- labels`
Expected: PASS.

- [ ] **Step 5: 승인 액션 코어 로직 테스트 작성 (실패 확인용)**

server action은 세션 의존성이 있으므로, DB 반영 로직을 `applyApproval`/`applyStatus`(주입식 prisma 사용)로 분리해 실 DB로 검증한다. Create `test/user-admin-actions.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { applyApproval, applyStatus } from "@/app/admin/users/actions";

beforeEach(async () => {
  await prisma.user.deleteMany();
});

describe("applyApproval", () => {
  it("activates a pending user and assigns role", async () => {
    const u = await prisma.user.create({ data: { email: "p@huno.kr" } });
    const res = await applyApproval({ userId: u.id, role: "PM" });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.status).toBe("ACTIVE");
    expect(after?.role).toBe("PM");
  });

  it("returns error for unknown user", async () => {
    const res = await applyApproval({ userId: "nope", role: "PM" });
    expect(res.ok).toBe(false);
  });
});

describe("applyStatus", () => {
  it("deactivates a user", async () => {
    const u = await prisma.user.create({ data: { email: "q@huno.kr", role: "PM", status: "ACTIVE" } });
    const res = await applyStatus({ userId: u.id, status: "INACTIVE" });
    expect(res.ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.status).toBe("INACTIVE");
  });
});
```

- [ ] **Step 6: 테스트 실행 → 실패 확인**

Run: `npm run test -- user-admin-actions`
Expected: FAIL — 모듈/함수 없음.

- [ ] **Step 7: 액션 구현**

Create `src/app/admin/users/actions.ts`:
```ts
"use server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import type { AppRole } from "@/lib/auth/rbac";

/** DB 반영 코어 (테스트 대상, 세션 비의존). */
export async function applyApproval(input: {
  userId: string;
  role: AppRole;
}): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.user.updateMany({
    where: { id: input.userId },
    data: { status: "ACTIVE", role: input.role },
  });
  if (result.count === 0) return { ok: false, error: "사용자를 찾을 수 없습니다." };
  return { ok: true };
}

export async function applyStatus(input: {
  userId: string;
  status: "ACTIVE" | "INACTIVE";
}): Promise<{ ok: boolean; error?: string }> {
  const result = await prisma.user.updateMany({
    where: { id: input.userId },
    data: { status: input.status },
  });
  if (result.count === 0) return { ok: false, error: "사용자를 찾을 수 없습니다." };
  return { ok: true };
}

/** 폼에서 호출하는 server action (ADMIN 전용). */
export async function approveUser(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as AppRole;
  await applyApproval({ userId, role });
  revalidatePath("/admin/users");
}

export async function changeStatus(formData: FormData): Promise<void> {
  await requireRole("ADMIN");
  const userId = String(formData.get("userId"));
  const status = String(formData.get("status")) as "ACTIVE" | "INACTIVE";
  await applyStatus({ userId, status });
  revalidatePath("/admin/users");
}
```

- [ ] **Step 8: 테스트 실행 → 통과 확인**

Run: `npm run test -- user-admin-actions`
Expected: PASS.

- [ ] **Step 9: 관리자 화면 작성**

Create `src/app/admin/users/page.tsx`:
```tsx
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { roleLabel, statusLabel } from "@/lib/labels";
import { approveUser, changeStatus } from "./actions";

export default async function AdminUsersPage() {
  await requireRole("ADMIN");
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <main className="p-8">
      <h1 className="mb-4 text-xl font-semibold">사용자·권한 관리</h1>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted)]">
            <th className="py-2">이메일</th>
            <th>이름</th>
            <th>역할</th>
            <th>상태</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-[var(--color-border)]">
              <td className="py-2">{u.email}</td>
              <td>{u.name ?? "-"}</td>
              <td>{roleLabel(u.role)}</td>
              <td>{statusLabel(u.status)}</td>
              <td className="flex gap-2 py-2">
                <form action={approveUser} className="flex gap-1">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={u.role ?? "PM"} className="border border-[var(--color-border)] rounded px-1">
                    <option value="ADMIN">관리자</option>
                    <option value="SETTLEMENT">정산담당자</option>
                    <option value="PM">PM</option>
                  </select>
                  <button type="submit" className="rounded bg-[var(--color-primary)] px-2 py-1 text-white">
                    승인/역할부여
                  </button>
                </form>
                <form action={changeStatus}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="status" value={u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
                  <button type="submit" className="rounded border border-[var(--color-border)] px-2 py-1">
                    {u.status === "ACTIVE" ? "비활성화" : "활성화"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 10: 빌드 확인 및 전체 테스트**

Run: `npm run build && npm run test`
Expected: 빌드 성공, 모든 테스트 통과.

- [ ] **Step 11: 커밋**

```bash
git add -A
git commit -m "feat: add admin user approval and role assignment"
```

---

## 최종 검증 (Definition of Done)

- [ ] `npm run test` — 전 테스트 통과(smoke, tokens, db, rls, domain, rbac, auth-callbacks, session-guard, labels, user-admin-actions).
- [ ] `npm run build` — 성공.
- [ ] 수동 확인(로컬 dev, `npm run dev`): `@huno.kr` 구글 로그인 → 최초 접근 시 `/pending` → 관리자가 `/admin/users`에서 승인·역할부여 → 재로그인/새로고침 시 접근 가능.
- [ ] RLS 검증: PM 컨텍스트에서 타 고객사 조회/수정 0건(test/rls.test.ts로 자동 검증됨).

## 다음 계획으로 넘어가기 전 확인

이 기반 계획이 제공하는 인터페이스(후속 Plan 2·3이 의존):
- `prisma` (`@/lib/db`), Prisma 모델·enum 전체.
- `withRLS(ctx, fn)` — **모든 고객사 귀속 데이터 접근은 이 헬퍼 안에서** 수행.
- `requireUser()`, `requireRole(role)`, `resolveGuard` — 서버 가드.
- `auth()`, 세션의 `user.id/role/status`.
- `hasAtLeast`, `canManageUsers`, `canEditSettlement` — 권한 판정.
- `roleLabel`, `statusLabel`, `expenseCategoryLabel`, `tokens` — 표시.
