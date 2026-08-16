/**
 * parse.mjs — capture/page.html 을 파싱해 data/recruitments.json 으로 변환
 *
 * (1차 자동 추정 버전) 실제 채용 목록의 컬럼을 보고 매핑을 다듬어야 합니다.
 * 이 스크립트는 capture/parse-report.json 에 테이블별 헤더 정보를 남겨서
 * 매핑 규칙을 확정하는 데 씁니다.
 *
 * 사용법:  npm run capture 실행 후 → npm run parse
 */
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'capture', 'page.html');
const OUT_PATH = path.join(ROOT, 'data', 'recruitments.json');
const REPORT_PATH = path.join(ROOT, 'capture', 'parse-report.json');

// 헤더 키워드 → 필드 매핑 (키워드가 헤더 셀에 포함되면 매핑)
// ※ UWINS 채용 그리드(CP1_grdView) 실제 컬럼 기준으로 확정됨:
//    신청번호, 근로구분, 장학기관명, 근로지명, 모집기간, 근로기간, 근로시간, 구분, 더보기
const HEADER_MAP = [
  ['id', ['신청번호', '접수번호', '번호']],
  ['category', ['근로구분', '업무분야', '직종', '분야', '유형']],
  ['department', ['장학기관명', '모집기관', '근무처', '모집부서', '부서', '기관', '소속']],
  ['title', ['근로지명', '근무지명', '공고명', '모집내용', '업무내용', '공고내용', '제목']],
  ['deadline', ['모집기간', '접수마감', '지원마감', '신청기간', '접수기간', '지원기간', '기한', '마감']],
  ['period', ['근로기간', '근무시간', '근무기간', '활동기간']],
  ['pay', ['장학금', '급여', '시급', '보수', '수당']],
  ['postedAt', ['등록일자', '등록일', '게시일', '작성일']],
  ['status', ['진행상태', '모집상태', '상태', '구분']],
];

function mapHeader(headerText) {
  const t = headerText.replace(/\s+/g, '');
  let best = null;
  let bestLen = 0;
  for (const [field, keys] of HEADER_MAP) {
    for (const k of keys) {
      if (t.includes(k) && k.length > bestLen) {
        best = field;
        bestLen = k.length;
      }
    }
  }
  return best;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  let html;
  try {
    html = await readFile(HTML_PATH, 'utf8');
  } catch {
    console.error('✗ capture/page.html 이 없습니다. 먼저 `npm run capture` 를 실행하세요.');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });

  const tables = await page.$$eval('table', (ts) =>
    ts.map((t) => {
      const headers = [...t.querySelectorAll('thead th, tr:first-child th, tr:first-child td')].map(
        (c) => c.innerText.trim()
      );
      const rows = [...t.querySelectorAll('tbody tr, tr')]
        .map((tr) => [...tr.querySelectorAll('td')].map((c) => c.innerText.trim()))
        .filter((r) => r.some((c) => c !== ''));
      return { headers, rows, rowCount: rows.length };
    })
  );

  await browser.close();

  // 가장 "리스트처럼 생긴" 테이블을 고른다 (행이 1개 이상이고 헤더가 있는 것 중 행 수 최대)
  const candidates = tables.filter((t) => t.rowCount >= 1 && t.headers.length >= 2);
  const listTable = candidates.sort((a, b) => b.rowCount - a.rowCount)[0] || null;

  const report = {
    parsedAt: new Date().toISOString(),
    tableCount: tables.length,
    candidates,
    chosenHeaders: listTable?.headers || [],
  };
  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  const items = [];
  if (listTable) {
    const { headers, rows } = listTable;
    const colField = headers.map(mapHeader);

    for (const row of rows) {
      const item = {};
      let rowHasContent = false;
      headers.forEach((h, i) => {
        const field = colField[i];
        let val = cleanText(row[i]);
        if (!field || !val) return;
        if (field === 'recruitCount') {
          const m = val.match(/\d+/);
          val = m ? m[0] : val;
        }
        item[field] = val;
        rowHasContent = true;
      });

      if (rowHasContent) {
        // 상세 링크는 제목 셀에서 <a href> 를 찾는 게 정확해서 DOM 재추출이 필요하나,
        // 1차 버전에서는 제목 텍스트만 저장하고 URL 은 후속 단계에서 보강.
        if (!item.id) item.id = `r${items.length + 1}`;
        items.push(item);
      }
    }
  }

  const result = {
    updatedAt: new Date().toISOString(),
    source: 'capture/page.html (자동 추정)',
    count: items.length,
    items,
  };
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(result, null, 2), 'utf8');

  console.log(`✓ ${items.length}건을 data/recruitments.json 으로 저장했습니다.`);
  console.log(`  파싱 진단: capture/parse-report.json`);
  if (items.length) {
    console.log('\n  첫 항목 미리보기:');
    console.log(JSON.stringify(items[0], null, 2));
  }
  console.log('\n  ※ 자동 매핑이므로 필드 이름이 실제와 다를 수 있습니다.');
  console.log('    capture/parse-report.json 의 chosenHeaders 를 확인해 매핑을 확정하세요.');
}

main();
