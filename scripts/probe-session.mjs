/**
 * probe-session.mjs — UWINS 세션 유지 실험
 *
 * 브라우저 프로필에 저장된 로그인 세션으로 MFA05U 페이지를 요청하고:
 *   1) 로그인 유지 여부 (200 vs 로그인 리다이렉트)
 *   2) ULSAN_UWINS 쿠키의 만료시각이 갱신되는지 (슬라이딩 세션 여부)
 * 를 확인합니다. 30분 로그아웃이 '고정 만료'인지 '활동 시 연장'인지 판별하는 용도.
 *
 * 사용법:  node scripts/probe-session.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
const TARGET = 'https://uwins.ulsan.ac.kr/SCHO/A/MFA05U.aspx?MenuID=MFA05U!1';

const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });

const before = (await context.cookies()).filter((c) => /uwins|ulsan/i.test(c.domain + c.name));
console.log('--- 요청 전 쿠키 ---');
for (const c of before) {
  console.log(
    `  ${c.domain} ${c.name}: expires=${c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString()}`
  );
}

const res = await context.request.get(TARGET, { maxRedirects: 0 });
console.log('\n--- 요청 결과 ---');
console.log(`  status: ${res.status()}`);
console.log(`  location: ${res.headers()['location'] || '(없음)'}`);
console.log(`  set-cookie: ${JSON.stringify(res.headers()['set-cookie'] || null)}`);

const after = (await context.cookies()).filter((c) => /uwins|ulsan/i.test(c.domain + c.name));
console.log('\n--- 요청 후 쿠키 ---');
for (const c of after) {
  console.log(
    `  ${c.domain} ${c.name}: expires=${c.expires === -1 ? 'session' : new Date(c.expires * 1000).toISOString()}`
  );
}

const ulsanBefore = before.find((c) => c.name === 'ULSAN_UWINS');
const ulsanAfter = after.find((c) => c.name === 'ULSAN_UWINS');
const renewed = ulsanBefore && ulsanAfter && ulsanAfter.expires > ulsanBefore.expires;
console.log(`\n=== 판정: ULSAN_UWINS 만료시각 ${renewed ? '갱신됨(슬라이딩 세션 — 하트비트로 유지 가능)' : '갱신 안 됨(고정 만료 가능성)'} ===`);

await context.close();
