// Prisma 생성 클라이언트의 `#main-entry-point` 서브패스 import를 상대경로 require로 바꾼다.
//
// 배경: 이 프로젝트 경로에는 한글(승환/개발/대시보드)이 들어 있다. Node의 CommonJS `#` 서브패스
// import 해석기는 모듈 경로에 비ASCII 문자가 있으면 "Cannot find module '#main-entry-point'"로
// 실패하는 버그가 있다(동일 패키지가 ASCII 경로에선 정상 동작). Prisma가 생성하는
// node_modules/.prisma/client/default.js가 `require('#main-entry-point')`를 써서 이 버그를 밟고,
// 그 결과 @prisma/client 로드가 실패해 테스트(prisma 의존 전 suite)와 next build가 깨진다.
//
// index.js는 상대경로 require만 쓰므로 정상 로드된다. default.js의 `#main-entry-point`를 './index.js'로
// 바꾸면 체인이 복구된다. default.js는 `prisma generate`가 다시 쓰므로, generate 직후(postinstall 및
// npm run prisma:generate)에 이 스크립트를 실행해 재적용한다. 멱등하므로 여러 번 돌려도 안전하다.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clientDir = join(process.cwd(), "node_modules", ".prisma", "client");
const target = join(clientDir, "default.js");
const NEEDLE = "require('#main-entry-point')";
const REPLACEMENT = "require('./index.js')";

if (!existsSync(target)) {
  // 아직 generate 전이거나 경로가 다르면 조용히 넘어간다(설치를 깨지 않는다).
  console.log("[fix-prisma-imports] .prisma/client/default.js 없음 — 건너뜀");
  process.exit(0);
}

const src = readFileSync(target, "utf8");
if (!src.includes(NEEDLE)) {
  console.log("[fix-prisma-imports] 이미 패치됨 — 변경 없음");
  process.exit(0);
}

writeFileSync(target, src.replace(NEEDLE, REPLACEMENT));
console.log("[fix-prisma-imports] default.js의 #main-entry-point → ./index.js 패치 완료");
