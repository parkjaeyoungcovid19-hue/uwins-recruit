/**
 * daemon.mjs — VPS 상시 실행 데몬
 *
 *  - 브라우저 세션을 유지하면서 10분마다 페이지 새로고침(하트비트)
 *    → 30분 유휴 로그아웃을 방지 (활동 시 세션 리셋 확인됨)
 *  - 60분마다 교내근로 + 국가근로 전체 페이지를 수집 → data/recruitments.json
 *  - 세션이 끊기면 UWINS_ID/UWINS_PW 로 자동 재로그인 (실패 시 5분 후 재시도)
 *
 * 환경변수: UWINS_ID, UWINS_PW (없으면 첫 로그인은 수동 필요)
 * 사용법:  node scripts/daemon.mjs
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

const HEARTBEAT_MS = 10 * 60 * 1000; // 새로고침 간격 (30분 만료 방지)
const SCRAPE_MS = 60 * 60 * 1000; // 전체 수집 간격
const MAX_PAGES = 12;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function toISO(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

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

async function onTarget(page) {
  try {
    return page.url().includes('MFA05U');
  } catch {
    return false;
  }
}

async function autoLogin(page) {
  const id = process.env.UWINS_ID;
  const pw = process.env.UWINS_PW;
  if (!id || !pw) {
    log('✗ UWINS_ID/UWINS_PW 미설정 — 자동 재로그인 불가 (수동 로그인 필요)');
    return false;
  }
  log(`자동 재로그인 시도 (id=${id})`);
  try {
    // UWINS 자체 Login.aspx 경유 (페이지 JS 가 agentId=78 로 SSO 전송)
    await page.goto('https://uwins.ulsan.ac.kr/Login.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    await page.fill('#CP1_id', id).catch(() => {});
    await page.fill('#CP1_pw', pw).catch(() => {});
    await page.locator('#CP1_btnLogin').click().catch(() => {});

    let loggedIn = false;
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(1000);
      const u = page.url();
      if (u.includes('uwins.ulsan.ac.kr') && !u.includes('/Login.aspx') && !u.includes('s.ulsan.ac.kr')) {
        loggedIn = true;
        break;
      }
      if (await page.locator('.captcha-lay').isVisible().catch(() => false)) {
        log('✗ CAPTCHA 정책에 걸림 — 자동 재로그인 불가. 수동 로그인이 필요합니다.');
        return false;
      }
    }
    if (!loggedIn) {
      log(`✗ 자동 재로그인 실패 (최종 URL: ${page.url().slice(0, 80)})`);
      return false;
    }
    log('✓ 자동 재로그인 성공');
    return true;
  } catch (e) {
    log(`✗ 자동 재로그인 오류: ${e.message}`);
    return false;
  }
}

async function ensureSession(page) {
  if (await onTarget(page)) return true;
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (await onTarget(page)) return true;

  log('세션 끊김 → 자동 재로그인 시도');
  if (await autoLogin(page)) {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    return onTarget(page);
  }
  return false;
}

async function extractRows(page) {
  const grid = page.locator('#CP1_grdView');
  return grid.locator('tbody tr, tr').evaluateAll((trs) => {
    const out = [];
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')].map((td) => td.innerText.trim());
      if (tds.length < 6) continue;
      out.push({
        id: tds[0],
        category: tds[1],
        department: tds[2],
        title: tds[3],
        recruitRange: tds[4],
        period: tds[5],
        hours: tds[6],
      });
    }
    return out;
  });
}

async function collectWorkType(page, filterLabel, radioId) {
  await page.locator(`#${radioId}`).click().catch(() => {});
  await page.waitForTimeout(3000);
  const all = new Map();
  for (let i = 0; i < MAX_PAGES; i++) {
    await page.waitForSelector('#CP1_grdView', { timeout: 15000 }).catch(() => {});
    const rows = await extractRows(page);
    for (const r of rows) all.set(r.id, r);

    const currentTexts = await page.locator('span[id*="Pager_spnPage"]').evaluateAll((ss) =>
      ss.map((s) => s.innerText.trim())
    );
    const pageLinks = await page.locator('a[id*="Pager_lbtnPage"]').evaluateAll((as) =>
      as.map((a) => ({ id: a.id, text: a.innerText.trim() }))
    );
    const current = Number(currentTexts[0]) || i + 1;
    const next = pageLinks.find((l) => Number(l.text) === current + 1);
    if (!next) break;
    await page.locator(`#${next.id}`).click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  log(`[${filterLabel}] ${all.size}건 수집`);
  return [...all.values()];
}

async function scrape(page) {
  log('── 전체 수집 시작 (교내근로 + 국가근로) ──');
  const merged = new Map();
  for (const [label, radioId] of [
    ['교내근로', 'CP1_rbtnlGeunloGb_1'],
    ['국가근로', 'CP1_rbtnlGeunloGb_2'],
  ]) {
    const rows = await collectWorkType(page, label, radioId);
    for (const r of rows) merged.set(r.id, r);
  }

  let state = { firstSeen: {} };
  try {
    state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    /* 첫 실행 */
  }
  const today = todayISO();
  const items = [...merged.values()]
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
  log(`✓ 수집 완료: ${items.length}건 → data/recruitments.json`);
  return true;
}

// ── main loop ───────────────────────────────────────────────────
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  locale: 'ko-KR',
});
const page = context.pages()[0] || (await context.newPage());

log('▶ 데몬 시작 — 10분 하트비트 / 60분 수집');

// 정상 종료 시 세션 쿠키 보존
process.on('SIGTERM', async () => {
  log('SIGTERM — 정상 종료');
  await context.close().catch(() => {});
  process.exit(0);
});

let ok = await ensureSession(page);
if (!ok) {
  log('최초 로그인 필요. 5분마다 자동 재로그인 재시도...');
}

let lastScrape = -SCRAPE_MS; // 시작 즉시 첫 수집 실행
for (;;) {
  if (!(await ensureSession(page))) {
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
    continue;
  }

  // 하트비트: 세션 유지용 새로고침
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  log('하트비트 ✓');

  if (Date.now() - lastScrape >= SCRAPE_MS) {
    try {
      await scrape(page);
      lastScrape = Date.now();
    } catch (e) {
      log(`✗ 수집 오류: ${e.message}`);
    }
  }

  await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
}
