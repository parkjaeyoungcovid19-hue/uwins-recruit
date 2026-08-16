/**
 * scrape.mjs — UWINS 채용 목록 자동 수집기 (VPS/헤드리스용)
 *
 * 동작:
 *   1) 브라우저 프로필의 세션으로 채용 목록(MFA05U) 접근
 *   2) 세션이 없으면:
 *      - UWINS_ID / UWINS_PW 환경변수가 있으면 → SSO 자동 로그인 (CAPTCHA 정책에 안 걸린 경우)
 *      - 없으면 → 터미널에서 id/pw 입력받아 1회 로그인 (값은 어디에도 저장 안 함)
 *   3) 목록 1페이지부터 모든 페이지를 순회하며 행 수집
 *   4) data/recruitments.json 생성 (+ 신규 공고 판별용 firstSeen 기록)
 *
 * 사용법:
 *   node scripts/scrape.mjs                 # 세션 있으면 바로 수집
 *   UWINS_ID=... UWINS_PW=... node scripts/scrape.mjs   # 자동 로그인 후 수집
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TARGET = 'https://uwins.ulsan.ac.kr/SCHO/A/MFA05U.aspx?MenuID=MFA05U!1';
const SSO_ENTRY = 'https://uwins.ulsan.ac.kr/sso/business.aspx';
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_PATH = path.join(DATA_DIR, 'recruitments.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const MAX_PAGES = 10;

function log(msg) {
  console.log(`[scrape] ${msg}`);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

function toISO(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "2026.08.07 ~ 2026.08.18" → 마지막 날짜를 YYYY-MM-DD 로
function endDate(rangeText) {
  const dates = [...String(rangeText || '').matchAll(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g)];
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  return toISO(Number(last[1]), Number(last[2]), Number(last[3]));
}

function todayISO() {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// ── 그리드 행 추출 ───────────────────────────────────────────────
// 컬럼 순서: 신청번호, 근로구분, 장학기관명, 근로지명, 모집기간, 근로기간, 근로시간, 구분, 더보기
async function extractRows(page) {
  const grid = page.locator('#CP1_grdView');
  const rows = await grid.locator('tbody tr, tr').evaluateAll((trs) => {
    const out = [];
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
      if (tds.length < 6) continue; // 헤더/빈 행 제외
      out.push({
        id: tds[0],
        category: tds[1],
        department: tds[2],
        title: tds[3],
        recruitRange: tds[4],
        period: tds[5],
        hours: tds[6],
        action: tds[7] || null,
      });
    }
    return out;
  });
  return rows;
}

async function collectAllPages(page, filterLabel) {
  const all = new Map();
  for (let i = 0; i < MAX_PAGES; i++) {
    await page.waitForSelector('#CP1_grdView', { timeout: 15000 }).catch(() => {});
    const rows = await extractRows(page);
    for (const r of rows) all.set(r.id, r);
    log(`[${filterLabel}] 페이지 ${i + 1}: ${rows.length}행 (누적 ${all.size}건)`);

    // 현재 페이지 번호 확인 → 다음 페이지 번호 클릭 (숫자 증가 방식)
    const currentTexts = await page.locator('span[id*="Pager_spnPage"]').evaluateAll((ss) =>
      ss.map((s) => s.innerText.trim())
    );
    const pageLinks = await page.locator('a[id*="Pager_lbtnPage"]').evaluateAll((as) =>
      as.map((a) => ({ id: a.id, text: a.innerText.trim() }))
    );
    const current = Number(currentTexts[0]) || i + 1;
    const next = pageLinks.find((l) => Number(l.text) === current + 1);
    if (!next) break;

    log(`  ↳ 다음 페이지(${next.text}) 클릭`);
    await page.locator(`#${next.id}`).click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  return [...all.values()];
}

// 근로구분 라디오: 1=교내근로, 2=국가근로
async function collectWorkType(page, filterLabel, radioId) {
  log(`근로구분 전환: ${filterLabel}`);
  await page.locator(`#${radioId}`).click().catch(() => {});
  await page.waitForTimeout(3000); // postback 반영 대기
  return collectAllPages(page, filterLabel);
}

// ── 자동 로그인 ────────────────────────────────────────────────
// 실제 흐름: UWINS 자체 Login.aspx 에서 id/pw 입력 → 페이지 JS 가
// agentId=78 로 s.ulsan.ac.kr/authentication/idpw/loginProcess 에 전송 → SSO 인증 → 복귀.
const UWINS_LOGIN = 'https://uwins.ulsan.ac.kr/Login.aspx';

async function autoLogin(page, id, pw) {
  log(`자동 로그인 시도 (id=${id})`);
  await page.goto(UWINS_LOGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.fill('#CP1_id', id).catch(() => {});
  await page.fill('#CP1_pw', pw).catch(() => {});

  // 페이지 자체 JS(GoToAuthentication)가 SSO 로 전송 (agentId=78)
  await page.locator('#CP1_btnLogin').click().catch(() => {});

  let loggedIn = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const u = page.url();
    if (u.includes('uwins.ulsan.ac.kr') && !u.includes('/Login.aspx') && !u.includes('s.ulsan.ac.kr')) {
      loggedIn = true;
      break;
    }
    if (await page.locator('.captcha-lay').isVisible().catch(() => false)) {
      log('✗ 보안문자(CAPTCHA) 요구 감지 — 자동 로그인 불가');
      break;
    }
  }

  if (!loggedIn) {
    log(`✗ 로그인 실패 (최종 URL: ${page.url().slice(0, 80)}) — 진단 정보 수집 중...`);
    try {
      await mkdir(path.join(ROOT, 'debug'), { recursive: true });
      const bodyText = await page.evaluate(() =>
        (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 400)
      );
      log('페이지 텍스트: ' + bodyText.slice(0, 280));
      await page.screenshot({ path: path.join(ROOT, 'debug', 'login-fail.png'), fullPage: true }).catch(() => {});
      await writeFile(path.join(ROOT, 'debug', 'login-fail.html'), await page.content(), 'utf8').catch(() => {});
      log('진단 저장: debug/login-fail.{png,html}');
    } catch {
      /* ignore */
    }
    return false;
  }
  log('✓ 로그인 성공');
  return true;
}

// ── main ────────────────────────────────────────────────────────
// --login : 로컬 수동 로그인 모드 (브라우저 창 열림, 로그인 후 바로 수집 + 세션유지 검증)
const HEADFUL = process.argv.includes('--login');
const CAPTURE_DIR = path.join(ROOT, 'capture');

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: !HEADFUL,
  viewport: { width: 1440, height: 900 },
  locale: 'ko-KR',
});
const page = context.pages()[0] || (await context.newPage());

let ok = false;
await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);

if (page.url().includes('MFA05U')) {
  log('✓ 기존 세션 유효 — 바로 수집');
  ok = true;
} else if (HEADFUL) {
  log(`세션 없음 (${page.url().slice(0, 60)}...) → 수동 로그인 대기 (최대 10분)`);
  console.log('\n열린 브라우저 창에서 평소처럼 로그인하세요.');
  console.log('로그인 후 채용 메뉴(MFA05U) 화면이 열리면 자동으로 수집을 시작합니다.');
  const waitStart = Date.now();
  while (Date.now() - waitStart < 10 * 60 * 1000) {
    if (page.url().includes('MFA05U')) {
      ok = true;
      break;
    }
    // 로그인은 됐는데 메뉴 미진입이면 20초마다 재시도
    if ((Date.now() - waitStart) % 20000 < 1000) {
      await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);
  }
} else {
  log(`세션 없음 (${page.url().slice(0, 60)}...) → 자동 로그인`);

  let id = process.env.UWINS_ID || null;
  let pw = process.env.UWINS_PW || null;

  if (!id || !pw) {
    if (process.env.CI) {
      log('✗ CI 실행인데 UWINS_ID/UWINS_PW 시크릿이 없습니다.');
      log('  GitHub 저장소 Settings → Secrets and variables → Actions 에 두 시크릿을 등록하고 다시 실행하세요.');
      await context.close();
      process.exit(1);
    }
    console.log('\n(입력한 id/pw 는 어디에도 저장되지 않습니다 — 로그인에만 사용)');
    id = (await ask('UWINS 아이디: ')).trim();
    pw = (await ask('UWINS 비밀번호: ')).trim();
  }

  ok = await autoLogin(page, id, pw);
  if (ok) {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (!page.url().includes('MFA05U')) ok = false;
  }
}

if (!ok) {
  log('✗ 수집 실패 — 세션이나 로그인 문제. (로컬에서는 npm run capture 로 수동 로그인 후 재시도)');
  await context.close();
  process.exit(1);
}

// ── 수집: 근로구분(교내근로/국가근로) 각각 전 페이지 ───────────────
const merged = new Map();
for (const [label, radioId] of [
  ['교내근로', 'CP1_rbtnlGeunloGb_1'],
  ['국가근로', 'CP1_rbtnlGeunloGb_2'],
]) {
  const rows = await collectWorkType(page, label, radioId);
  for (const r of rows) merged.set(r.id, r);
}
const rows = [...merged.values()];
log(`총 수집: ${rows.length}건 (교내+국가)`);

// 신규 판별용 firstSeen 기록
let state = { firstSeen: {} };
try {
  state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
} catch {
  /* 첫 실행 */
}
const today = todayISO();
const items = rows
  .map((r) => {
    const deadline = endDate(r.recruitRange);
    const firstSeen = state.firstSeen[r.id] || today;
    state.firstSeen[r.id] = firstSeen;
    return {
      id: r.id,
      title: r.title || r.department || '(제목 없음)',
      department: r.department || '',
      category: r.category || '',
      period: r.period || '',
      hours: r.hours || '',
      recruitRange: r.recruitRange || '',
      deadline,
      postedAt: firstSeen,
      status: deadline && deadline < today ? '마감' : '모집중',
      url: TARGET,
    };
  })
  .filter((it) => it.title && it.title !== '(제목 없음)')
  .sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);

await mkdir(DATA_DIR, { recursive: true });
await writeFile(OUT_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), count: items.length, items }, null, 2), 'utf8');
await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');

log(`✓ 완료: ${items.length}건 → data/recruitments.json`);

// ── (--login 모드) 같은 세션에서 30분 만료 여부 검증 ─────────────
// 10분마다 페이지 새로고침(핑). 유지되면 "활동 시 연장" → VPS 하트비트 방식 확정.
if (HEADFUL) {
  await mkdir(CAPTURE_DIR, { recursive: true });
  const timeline = [];
  const t0 = Date.now();
  console.log('\n세션 유지 검증 시작 (약 40분). 브라우저 창을 닫지 말고 그대로 두세요.');
  console.log('10분마다 자동으로 새로고침하며 세션이 유지되는지 확인합니다.\n');

  let alive = true;
  for (let i = 0; i < 4 && alive; i++) {
    await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
    const r = await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    alive = !!r && page.url().includes('MFA05U');
    const tMin = Math.round((Date.now() - t0) / 60000);
    timeline.push({ tMin, status: r ? r.status() : 0, alive });
    log(`핑 t+${tMin}분 → ${alive ? '✓ 유지' : '✗ 끊김'}`);
    await writeFile(
      path.join(CAPTURE_DIR, 'session-experiment.json'),
      JSON.stringify({ startedAt: new Date(t0).toISOString(), timeline }, null, 2),
      'utf8'
    ).catch(() => {});
  }

  log(alive ? '✓ 40분 유지 — 하트비트(주기적 새로고침)로 세션 유지 가능 확정' : '✗ 끊김 — 30분 고정 만료, 자동 재로그인 필요');
}

await context.close(); // 세션 보존을 위해 깨끗하게 종료
