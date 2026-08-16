/**
 * session-keepalive.mjs — 30분 세션 만료 판정 실험
 *
 * 1) 브라우저 창을 열고 사용자가 로그인 (이전 세션이 남아 있으면 자동 진행)
 * 2) 채용 목록(MFA05U)이 열리면 시작 시각 기록
 * 3) 10분마다 같은 페이지를 요청하며 세션 유지 여부 확인
 *    - 활동(요청)을 계속해도 세션이 유지되면 → 하트비트로 무인 유지 가능
 *    - 약 30분에 무조건 끊기면 → 고정 만료 → 자동 재로그인 설계 필요
 * 4) 결과 타임라인을 capture/session-experiment.json 에 저장
 *
 * 사용법:  node scripts/session-keepalive.mjs   (약 50분 소요)
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
const CAPTURE_DIR = path.join(ROOT, 'capture');
const TARGET = 'https://uwins.ulsan.ac.kr/SCHO/A/MFA05U.aspx?MenuID=MFA05U!1';
const PING_INTERVAL_MS = 10 * 60 * 1000; // 10분 간격
const EXPERIMENT_MS = 50 * 60 * 1000; // 총 50분
const LOGIN_WAIT_MS = 10 * 60 * 1000;

await mkdir(CAPTURE_DIR, { recursive: true });
const timeline = [];
const startedAt = Date.now();

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
}

function mins() {
  return Math.round((Date.now() - startedAt) / 60000);
}

async function saveResult() {
  await writeFile(
    path.join(CAPTURE_DIR, 'session-experiment.json'),
    JSON.stringify({ startedAt: new Date(startedAt).toISOString(), timeline }, null, 2),
    'utf8'
  ).catch(() => {});
}

async function ping(context) {
  const res = await context.request.get(TARGET, { maxRedirects: 0 });
  const ulsan = (await context.cookies()).find((c) => c.name === 'ULSAN_UWINS');
  const ok = res.status() === 200;
  const entry = {
    tMin: mins(),
    status: res.status(),
    location: res.headers()['location'] || null,
    ulsanUwinsExpires: ulsan && ulsan.expires !== -1 ? new Date(ulsan.expires * 1000).toISOString() : null,
  };
  timeline.push(entry);
  await saveResult();
  log(
    `ping t+${entry.tMin}분 → ${ok ? '✓ 유지(200)' : `✗ 끊김(${res.status()} → ${entry.location || ''})`}` +
      (entry.ulsanUwinsExpires ? ` | ULSAN_UWINS 만료: ${entry.ulsanUwinsExpires.slice(11, 19)}` : '')
  );
  return ok;
}

console.log('▶ 세션 유지 실험 시작 (약 50분 소요). 브라우저 창이 열립니다.');
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1200, height: 800 },
  locale: 'ko-KR',
});
const page = context.pages()[0] || (await context.newPage());

await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);

const waitStart = Date.now();
while (Date.now() - waitStart < LOGIN_WAIT_MS) {
  if (page.url().includes('MFA05U')) break;
  // 로그인은 됐는데 메뉴 미진입 상태면 20초마다 재시도 (로그인 완료 시 자동 진입)
  if ((Date.now() - waitStart) % 20000 < 1000) {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}

if (!page.url().includes('MFA05U')) {
  console.log('로그인 대기 시간 초과. 창에서 로그인 후 다시 실행해 주세요.');
  await context.close();
  process.exit(1);
}

log('✓ 채용 목록 열림 — 세션 유지 실험 시작 (10분 간격 핑)');
await saveResult();

let alive = true;
const deadline = Date.now() + EXPERIMENT_MS;
while (Date.now() < deadline && alive) {
  await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
  alive = await ping(context);
}

log(alive ? '✓ 50분 경과 — 세션 유지됨 (활동 시 세션 연장됨, 하트비트 방식 가능)' : '✗ 세션 만료 감지 — 고정 만료 가능성 (자동 재로그인 설계 필요)');
await saveResult();
await context.close(); // 세션 쿠키 보존을 위해 깨끗하게 종료
log('결과 저장: capture/session-experiment.json');
