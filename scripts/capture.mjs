/**
 * capture.mjs — UWINS 근로장학 채용 목록 수집 스크립트 (1회 수동 로그인 방식) v2
 *
 * 개선점:
 *  - 모든 탭/팝업/iframe 의 URL·네트워크를 감지
 *  - 네트워크 기록과 매니페스트를 실시간으로 저장 (타임아웃돼도 로그인 과정 기록은 남음)
 *  - 페이지 URL 변화를 콘솔에 출력 (어디까지 진행됐는지 보임)
 *
 * 사용법:  npm run capture
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TARGET_URL =
  'https://uwins.ulsan.ac.kr/SCHO/A/MFA05U.aspx?MenuID=MFA05U!1';
const MENU_MARKER = 'MFA05U'; // 채용 메뉴를 식별하는 URL 조각
const LOGIN_WAIT_MS = 15 * 60 * 1000; // 수동 로그인 대기 최대 15분

const CAPTURE_DIR = path.join(ROOT, 'capture');
const NETWORK_DIR = path.join(CAPTURE_DIR, 'network');
const FRAMES_DIR = path.join(CAPTURE_DIR, 'frames');
const PROFILE_DIR = path.join(ROOT, '.browser-profile');

await mkdir(NETWORK_DIR, { recursive: true });
await mkdir(FRAMES_DIR, { recursive: true });

const captured = [];

// 비밀번호 등 민감 값은 manifest 에 절대 기록하지 않습니다.
const SENSITIVE_KEYS = ['pw', 'passwd', 'password', 'pwd', 'captcha', 'securityAnswer', '비밀번호', '암호'];

function redactPostData(postData) {
  if (!postData) return null;
  try {
    const params = new URLSearchParams(postData);
    let changed = false;
    for (const key of [...params.keys()]) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        params.set(key, '***REDACTED***');
        changed = true;
      }
    }
    return changed ? params.toString() : postData;
  } catch {
    return postData;
  }
}

function safeName(url) {
  try {
    const u = new URL(url);
    const base = (u.pathname.split('/').pop() || 'resp').replace(/[^a-zA-Z0-9_-]/g, '_');
    return base.slice(0, 40);
  } catch {
    return 'resp';
  }
}

const manifestPath = path.join(NETWORK_DIR, 'manifest.json');

async function saveManifest(extra = {}) {
  try {
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          target: TARGET_URL,
          capturedAt: new Date().toISOString(),
          ...extra,
          responses: captured,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    /* ignore */
  }
}

console.log('▶ Chromium 실행 중... (브라우저 창이 열립니다)');
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: 'ko-KR',
});

// ── 네트워크 캡처: context 전체(모든 탭·팝업) ─────────────────────
context.on('response', async (res) => {
  try {
    const req = res.request();
    const ct = res.headers()['content-type'] || '';
    const isXHR = ['xhr', 'fetch'].includes(req.resourceType());
    const looksData = /json|xml|text\/plain/.test(ct);
    const isDoc = req.resourceType() === 'document';
    if (!isXHR && !looksData && !isDoc) return;

    const idx = captured.length;
    const entry = {
      idx,
      method: req.method(),
      url: req.url(),
      type: req.resourceType(),
      postData: redactPostData(req.postData()),
      status: res.status(),
      contentType: ct,
      setCookie: res.headers()['set-cookie'] || null,
      savedAs: null,
    };

    if (isXHR || looksData) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }
      if (body.length > 2_000_000) body = body.slice(0, 2_000_000);
      const fname = `${String(idx).padStart(3, '0')}-${safeName(req.url())}.json`;
      entry.savedAs = fname;
      await writeFile(path.join(NETWORK_DIR, fname), body, 'utf8').catch(() => {});
    }

    captured.push(entry);
    if (captured.length % 10 === 0) await saveManifest();
    console.log(`  ↳ [${res.status()}] ${req.method()} ${req.resourceType()} ${req.url().slice(0, 100)}`);
  } catch {
    /* ignore */
  }
});

// ── 대상 페이지로 이동 ───────────────────────────────────────────
const page = context.pages()[0] || (await context.newPage());
console.log(`▶ 이동: ${TARGET_URL}`);
await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('열린 Chromium 창에서 평소처럼 로그인하세요.');
console.log('로그인 후에는 근로장학 > 채용 메뉴까지 직접 클릭해서 들어가 주세요.');
console.log(`채용 메뉴(${MENU_MARKER}) 화면이 열리면 자동으로 캡처를 시작합니다.`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── URL 이동 추적 + 대상 감지 (모든 탭·프레임) ───────────────────
const seenUrls = new Set();

function findTarget() {
  for (const p of context.pages()) {
    try {
      if (p.url().includes(MENU_MARKER)) {
        return { page: p, frame: p.mainFrame() };
      }
      for (const f of p.frames()) {
        if (f.url().includes(MENU_MARKER)) return { page: p, frame: f };
      }
    } catch {
      /* closed page */
    }
  }
  return null;
}

function watchUrls() {
  for (const p of context.pages()) {
    try {
      const u = p.url();
      if (!seenUrls.has(u)) {
        seenUrls.add(u);
        console.log(`  [URL] ${u.slice(0, 120)}`);
      }
    } catch {
      /* ignore */
    }
  }
}

const start = Date.now();
let target = findTarget();
while (Date.now() - start < LOGIN_WAIT_MS) {
  watchUrls();
  target = findTarget();
  if (target) break;
  await new Promise((r) => setTimeout(r, 1000));
}

if (!target) {
  console.log('\n⏱ 대기 시간 초과 — 채용 메뉴 화면(MFA05U)이 감지되지 않았습니다.');
  console.log('   (기록된 네트워크 로그와 쿠키는 capture/network/manifest.json 에 저장됨)');
  await saveManifest({
    cookies: (await context.cookies()).map((c) => ({
      name: c.name,
      domain: c.domain,
      expires: c.expires === -1 ? 'session(브라우저 종료까지)' : new Date(c.expires * 1000).toISOString(),
    })),
  });
  await context.close();
  process.exit(1);
}

console.log('✓ 채용 목록 화면 감지. 로딩 대기 중...');
await target.page.bringToFront().catch(() => {});
await new Promise((r) => setTimeout(r, 5000));

// 목록이 '조회' 버튼 클릭 후 나오는 경우 대비
try {
  const searchBtn = target.page.locator(
    "input[type='button'][value*='조회'], button:has-text('조회'), a:has-text('조회')"
  );
  if ((await searchBtn.count()) === 1) {
    console.log('  ↳ "조회" 버튼 발견 → 클릭');
    await searchBtn.first().click().catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
  }
} catch {
  /* ignore */
}

// ── 저장 ────────────────────────────────────────────────────────
// 1) 메인 프레임 HTML
await writeFile(path.join(CAPTURE_DIR, 'page.html'), await target.page.content(), 'utf8');
// 2) 모든 프레임(iframe) HTML — 목록이 iframe 안에 있어도 놓치지 않음
let frameIdx = 0;
const frameList = [];
for (const p of context.pages()) {
  for (const f of p.frames()) {
    try {
      const url = f.url();
      if (!url || url === 'about:blank') continue;
      const html = await f.content().catch(() => '');
      if (!html) continue;
      const fname = `${String(frameIdx).padStart(2, '0')}-${safeName(url)}.html`;
      await writeFile(path.join(FRAMES_DIR, fname), html, 'utf8').catch(() => {});
      frameList.push({ file: fname, url });
      frameIdx++;
    } catch {
      /* ignore */
    }
  }
}
// 3) 스크린샷
await target.page.screenshot({ path: path.join(CAPTURE_DIR, 'page.png'), fullPage: true }).catch(() => {});
// 4) 쿠키 목록(이름·도메인·만료시각, 값은 저장 안 함) + 네트워크 기록
await saveManifest({
  targetPage: target.frame.url(),
  frames: frameList,
  cookies: (await context.cookies()).map((c) => ({
    name: c.name,
    domain: c.domain,
    expires: c.expires === -1 ? 'session(브라우저 종료까지)' : new Date(c.expires * 1000).toISOString(),
  })),
});

console.log('\n✓ 완료. 저장된 파일:');
console.log('  - capture/page.html            (메인 화면 HTML)');
console.log(`  - capture/frames/              (iframe ${frameList.length}개)`);
console.log('  - capture/page.png             (스크린샷)');
console.log(`  - capture/network/             (네트워크 기록 ${captured.length}건)`);
console.log('  - capture/network/manifest.json (쿠키 목록 + 요청 기록)');
console.log('\n브라우저 창은 열어둡니다. 작업이 끝나면 이 창을 닫아도 됩니다.');
