// app.js — Notion 스타일 근로장학 채용 목록
// 데이터: /data/recruitments.json (daemon/scrape 이 생성)

const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;

const state = {
  query: '',
  workType: 'all', // all | 교내근로 | 국가근로
  onlyOpen: true,
  soonOnly: false,
  newOnly: false,
  hideDone: false,
  sort: 'deadline', // deadline | newest
  panelOpen: false,
  view: "dashboard",
};

let allItems = [];

/* ── 날짜 유틸 ─────────────────────────────────────────────── */
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function today() {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}
function dDay(deadline) {
  const d = parseDate(deadline);
  if (!d) return null;
  return Math.round((d - today()) / DAY);
}
function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return s || '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function isNew(item) {
  const p = parseDate(item.postedAt);
  return p && (today() - p) / DAY <= 3;
}
function isDone(item) {
  const dd = dDay(item.deadline);
  return item.status === '마감' || (dd !== null && dd < 0);
}

/* ── 필터 ──────────────────────────────────────────────────── */
function matches(item) {
  const dd = dDay(item.deadline);
  const done = isDone(item);

  if (state.workType !== 'all' && item.category !== state.workType) return false;
  if (state.onlyOpen && done) return false;
  if (state.soonOnly && !(dd !== null && dd >= 0 && dd <= 3 && !done)) return false;
  if (state.newOnly && !isNew(item)) return false;
  if (state.hideDone && done) return false;

  if (state.query) {
    const hay = [item.title, item.department, item.category, item.hours, item.period]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(state.query.toLowerCase())) return false;
  }
  return true;
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (state.sort === 'newest') {
      return (parseDate(b.postedAt)?.getTime() || 0) - (parseDate(a.postedAt)?.getTime() || 0);
    }
    const da = dDay(a.deadline), db = dDay(b.deadline);
    const va = da === null ? Infinity : da;
    const vb = db === null ? Infinity : db;
    const ra = isDone(a) ? 1 : 0, rb = isDone(b) ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (va !== vb) return va - vb;
    return (parseDate(b.postedAt)?.getTime() || 0) - (parseDate(a.postedAt)?.getTime() || 0);
  });
}

/* ── 아이콘 & 매핑 로직 ────────────────────────────────────── */
const ICONS = {
  '도서관': '📚', '기숙사': '🛏️', '학생생활관': '🛏️', '행정': '🏢', '본부': '🏢', 
  '전산': '💻', 'IT': '💻', '정보통신': '💻', '병원': '🏥', '보건': '🏥', 
  '초등': '🏫', '중학': '🏫', '고등': '🏫', '유치원': '🏫', '아동센터': '🧒', 
  '우체국': '📮', '주민센터': '🏛️', '시청': '🏛️', '구청': '🏛️', '연구소': '🔬', 
  '실험실': '🔬', '과학': '🔬', '체육': '⚽', '스포츠': '⚽', '예술': '🎨', 
  '디자인': '🎨', '어학': '🌐', '글로벌': '🌐', '국제': '🌐', '취업': '💼', 
  '진로': '💼', '단과대학': '🏛️', '학부': '🎓', '학과': '🎓', '학생회': '🗣️',
};

function getIcon(item) {
  const text = (item.department + ' ' + item.title).toLowerCase();
  for (const [key, icon] of Object.entries(ICONS)) {
    if (text.includes(key)) return icon;
  }
  return '📁';
}

function getLocation(item) {
  const text = (item.department + ' ' + item.title).toLowerCase();
  if (text.includes('교외') || text.includes('외부기관') || item.category.includes('교외')) return '교외';
  if (text.includes('교내') || text.includes('학내') || item.category.includes('교내')) return '교내';
  if (/(초등|중|고등)학교/.test(text) || /(아동센터|우체국|주민센터|시청|구청|복지관|도서관\s*\(?공공\)?)/.test(text)) return '교외';
  return '교내';
}

const UOU_LOCATIONS = [
  { keywords: ['도서관', '아산도서관'], lat: 35.5441, lng: 129.2555 },
  { keywords: ['기숙사', '학생생활관', '무거관', '기린관', '목련관'], lat: 35.5410, lng: 129.2520 },
  { keywords: ['학생회관', '학생복지관'], lat: 35.5430, lng: 129.2570 },
  { keywords: ['본부', '교무처', '학생처', '취업', '총무처'], lat: 35.5445, lng: 129.2580 },
  { keywords: ['공과대학', '건축관', '산업공학', '기계', '전기', '화학', 'IT', '전산'], lat: 35.5455, lng: 129.2550 },
  { keywords: ['자연과학', '생활과학', '과학', '실험'], lat: 35.5425, lng: 129.2545 },
  { keywords: ['경영대학', '사회과학'], lat: 35.5435, lng: 129.2590 },
  { keywords: ['인문대학', '어학', '국제', '글로벌'], lat: 35.5420, lng: 129.2585 },
  { keywords: ['디자인', '예술', '음악', '미술'], lat: 35.5400, lng: 129.2560 },
  { keywords: ['체육관', '스포츠'], lat: 35.5450, lng: 129.2510 },
  { keywords: ['아산스포츠'], lat: 35.5470, lng: 129.2530 },
];
let mapInstance = null;
let markersLayer = null;

function renderMap(items) {
  if (!mapInstance) {
    if (typeof L === 'undefined') return;
    mapInstance = L.map('map').setView([35.5438, 129.2562], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance);
    markersLayer = L.layerGroup().addTo(mapInstance);
    setTimeout(() => mapInstance.invalidateSize(), 100);
  }
  markersLayer.clearLayers();
  
  const bounds = [];
  const offCampusItems = [];
  const onCampusClusters = {};
  
  items.forEach(item => {
    const isOffCampus = getLocation(item) === '교외';
    if (isOffCampus) {
      offCampusItems.push(item);
      return;
    }
    const text = item.department + ' ' + item.title;
    let found = false;
    for (let loc of UOU_LOCATIONS) {
      if (loc.keywords.some(k => text.includes(k))) {
        const key = loc.lat + ',' + loc.lng;
        if (!onCampusClusters[key]) onCampusClusters[key] = { lat: loc.lat, lng: loc.lng, items: [] };
        onCampusClusters[key].items.push(item);
        found = true;
        break;
      }
    }
    if (!found) {
      const key = '35.5438,129.2562';
      if (!onCampusClusters[key]) onCampusClusters[key] = { lat: 35.5438, lng: 129.2562, items: [] };
      onCampusClusters[key].items.push(item);
    }
  });
  
  for (let key in onCampusClusters) {
    const c = onCampusClusters[key];
    const html = c.items.map(i => `<div>${getIcon(i)} ${i.title}</div>`).join('');
    const marker = L.marker([c.lat, c.lng]).bindPopup(`<div class="map-popup-title">교내 (${c.items.length}건)</div>${html}`);
    markersLayer.addLayer(marker);
    bounds.push([c.lat, c.lng]);
  }
  
  if (offCampusItems.length > 0) {
    const offLat = 35.5390, offLng = 129.2450;
    const html = offCampusItems.map(i => `<div>${getIcon(i)} ${i.title}</div>`).join('');
    const marker = L.marker([offLat, offLng]).bindPopup(`<div class="map-popup-title">교외 (${offCampusItems.length}건)</div>${html}`);
    markersLayer.addLayer(marker);
    bounds.push([offLat, offLng]);
  }
  
  if (bounds.length > 0) mapInstance.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
}

/* ── 렌더링 ────────────────────────────────────────────────── */
function badgesFor(item, dd, done) {
  const out = [];
  const loc = getLocation(item);
  if (item.category === '국가근로') {
    out.push(['national', loc === '교외' ? '국가근로(교외)' : '국가근로(교내)']);
  } else {
    out.push(['school', '교내근로']);
  }
  if (done) {
    out.push(['done', '마감']);
  } else {
    if (isNew(item)) out.push(['new', 'NEW']);
    if (dd === 0) out.push(['today', '오늘 마감']);
    else if (dd !== null && dd <= 3) out.push(['soon', `D-${dd}`]);
    else out.push(['open', '모집중']);
  }
  return out;
}

function cardNode(item, isHorizontal = false) {
  const tpl = $('cardTpl');
  const node = tpl.content.firstElementChild.cloneNode(true);
  const dd = dDay(item.deadline);
  const done = isDone(item);
  
  if (isHorizontal) {
    node.className = 'h-card ' + (dd !== null && dd <= 3 ? 'red' : 'green');
    node.innerHTML = `
      <div class="card-icon">${getIcon(item)}</div>
      <div class="card-top">
        <div class="badges"></div>
        <h3 class="card-title">${item.title || '(제목 없음)'}</h3>
      </div>
      <div class="card-org">${item.department || ''}</div>
      <a class="detail" target="_blank" rel="noopener"${item.url ? ` href="${item.url}"` : ''}>지원하기 →</a>
    `;
  } else {
    if (done) node.classList.add('done');
    const iconEl = node.querySelector('.card-icon');
    if(iconEl) iconEl.textContent = getIcon(item);
    node.querySelector('.card-title').textContent = item.title || '(제목 없음)';
    node.querySelector('.card-org').textContent = item.department || '';
    node.querySelector('.hours').textContent = item.hours || '—';
    node.querySelector('.period').textContent = item.period || '—';
    node.querySelector('.recruitRange').textContent = item.recruitRange || '—';
    const dl = node.querySelector('.deadline');
    dl.textContent = item.deadline ? fmtDate(item.deadline) : '—';
    if (!done && dd === 0) dl.classList.add('today');
    else if (!done && dd !== null && dd <= 3) dl.classList.add('soon');
    const a = node.querySelector('.detail');
    if (item.url) a.href = item.url;
    else a.remove();
  }
  
  const bw = node.querySelector('.badges');
  for (const [cls, text] of badgesFor(item, dd, done)) {
    const b = document.createElement('span');
    b.className = `badge ${cls}`;
    b.textContent = text;
    bw.appendChild(b);
  }

  return node;
}

function render() {
  const filtered = sortItems(allItems.filter(matches));
  
  if (state.view === 'map') {
    $('dashboardView').hidden = true;
    $('mapView').hidden = false;
    renderMap(filtered);
  } else {
    $('dashboardView').hidden = false;
    $('mapView').hidden = true;
    
    const sectionsEl = $('sections');
    const hSectionsEl = $('horizontalSections');
    if (hSectionsEl) hSectionsEl.innerHTML = '';
    if (sectionsEl) sectionsEl.innerHTML = '';

    const activeItems = filtered.filter(i => !isDone(i));
    const urgentItems = activeItems.filter(i => { const d = dDay(i.deadline); return d !== null && d <= 3; });
    const newItems = activeItems.filter(isNew);
    
    if (!state.query && (urgentItems.length > 0 || newItems.length > 0) && hSectionsEl) {
      const topItems = Array.from(new Set([...urgentItems, ...newItems])).slice(0, 8);
      const sec = $('sectionTpl').content.firstElementChild.cloneNode(true);
      sec.querySelector('.section-title').textContent = '🔥 추천 공고';
      sec.querySelector('.section-count').textContent = '마감임박 & 신규';
      const ul = sec.querySelector('.list');
      ul.className = 'horizontal-scroll';
      for (const item of topItems) ul.appendChild(cardNode(item, true));
      hSectionsEl.appendChild(sec);
    }
    
    let visible = 0;
    const groups = state.workType === 'all'
      ? ['교내근로', '국가근로'].map((g) => [g, filtered.filter((i) => i.category === g)])
      : [[state.workType, filtered]];

    for (const [group, items] of groups) {
      if (!items.length) continue;
      const sec = $('sectionTpl').content.firstElementChild.cloneNode(true);
      const dot = document.createElement('span');
      dot.className = `dot ${group === '국가근로' ? 'national' : 'school'}`;
      sec.querySelector('.section-head').prepend(dot);
      sec.querySelector('.section-title').textContent = group;
      sec.querySelector('.section-count').textContent = `${items.length}건`;
      const ul = sec.querySelector('.list');
      for (const item of items) ul.appendChild(cardNode(item));
      sectionsEl.appendChild(sec);
      visible += items.length;
    }
    $('empty').hidden = visible > 0;
  }

  const open = allItems.filter((i) => !isDone(i)).length;
  const todayCount = allItems.filter((i) => dDay(i.deadline) === 0 && !isDone(i)).length;
  const newCount = allItems.filter((i) => isNew(i) && !isDone(i)).length;
  $('statOpen').textContent = open;
  $('statToday').textContent = todayCount;
  $('statNew').textContent = newCount;
  $('statTotal').textContent = allItems.length;

  renderChips();
}

/* ── 활성 필터 칩 ──────────────────────────────────────────── */

function activeFilters() {
  const out = [];
  if (state.workType !== 'all') out.push({ key: 'workType', label: state.workType });
  if (state.soonOnly) out.push({ key: 'soonOnly', label: '마감임박' });
  if (state.newOnly) out.push({ key: 'newOnly', label: '신규' });
  if (state.hideDone) out.push({ key: 'hideDone', label: '마감 숨김' });
  if (state.query) out.push({ key: 'query', label: `"${state.query}"` });
  return out;
}

function renderChips() {
  const chipsEl = $('chips');
  const filters = activeFilters();
  chipsEl.innerHTML = '';
  chipsEl.hidden = filters.length === 0;
  for (const f of filters) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${f.label} <button title="해제">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => {
      if (f.key === 'workType') setWorkType('all');
      else if (f.key === 'query') { state.query = ''; $('search').value = ''; }
      else state[f.key] = false;
      syncControls();
      render();
    });
    chipsEl.appendChild(chip);
  }
  $('filterCount').textContent = filters.length;
  $('filterCount').hidden = filters.length === 0;
  $('filterToggle').classList.toggle('on', state.panelOpen || filters.length > 0);
}

/* ── 컨트롤 동기화 ─────────────────────────────────────────── */
function setWorkType(v) {
  state.workType = v;
  document.querySelectorAll('#workTypeSeg .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === v);
  });
}
function setSort(v) {
  state.sort = v;
  document.querySelectorAll('#sortSeg .seg').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === v);
  });
}
function syncControls() {
  $('onlyOpen').checked = state.onlyOpen;
  $('soonOnly').checked = state.soonOnly;
  $('newOnly').checked = state.newOnly;
  $('hideDone').checked = state.hideDone;
  setWorkType(state.workType);
  setSort(state.sort);
}

/* ── 이벤트 ────────────────────────────────────────────────── */
function bindEvents() {
  document.querySelectorAll('#viewSeg .seg').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#viewSeg .seg').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.view = b.dataset.view;
      render();
      if (state.view === 'map' && mapInstance) setTimeout(() => mapInstance.invalidateSize(), 100);
    });
  });

  $('search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    render();
  });

  $('filterToggle').addEventListener('click', () => {
    state.panelOpen = !state.panelOpen;
    $('filterPanel').hidden = !state.panelOpen;
    $('filterToggle').classList.toggle('on', state.panelOpen || activeFilters().length > 0);
  });

  document.querySelectorAll('#workTypeSeg .seg').forEach((b) => {
    b.addEventListener('click', () => { setWorkType(b.dataset.value); render(); });
  });
  document.querySelectorAll('#sortSeg .seg').forEach((b) => {
    b.addEventListener('click', () => { setSort(b.dataset.value); render(); });
  });
  const binds = [
    ['onlyOpen', 'onlyOpen'],
    ['soonOnly', 'soonOnly'],
    ['newOnly', 'newOnly'],
    ['hideDone', 'hideDone'],
  ];
  for (const [id, key] of binds) {
    $(id).addEventListener('change', (e) => {
      state[key] = e.target.checked;
      render();
    });
  }
}

/* ── 암호화 데이터(비공개 모드) ─────────────────────────────── */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decryptData(enc, password) {
  const salt = b64ToBytes(enc.salt);
  const iv = b64ToBytes(enc.iv);
  const ct = b64ToBytes(enc.ct);
  const enc2 = new TextEncoder();

  // Safari 구형 포함 최대 호환: deriveBits → importKey 방식
  const keyMaterial = await crypto.subtle.importKey('raw', enc2.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: enc.kdf?.iterations || 200000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(plain);
}

/* ── 초기화 ────────────────────────────────────────────────── */
async function loadPlainData() {
  const res = await fetch('/data/recruitments.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadEncryptedData(password) {
  const res = await fetch('./data.enc', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const enc = await res.json();
  const plain = await decryptData(enc, password);
  return JSON.parse(plain);
}

function showLock() {
  const lock = $('lock');
  lock.hidden = false;
  lock.style.display = 'flex'; // CSS 충돌과 무관하게 항상 표시
  $('lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('lockPw').value;
    $('lockErr').hidden = true;
    try {
      const data = await loadEncryptedData(pw);
      allItems = data.items || [];
      $('updatedAt').textContent = data.updatedAt
        ? `갱신: ${fmtDate(data.updatedAt)} (총 ${allItems.length}건)`
        : '갱신: —';
      // 인라인 스타일로 강제 숨김 — 어떤 CSS보다 우선 (한 번에 확실하게)
      lock.hidden = true;
      lock.style.display = 'none';
      bindEvents();
      syncControls();
      render();
    } catch (err) {
      console.warn('복호화 실패:', err);
      $('lockErr').textContent =
        err && err.message && err.message.includes('HTTP')
          ? `데이터 파일을 불러오지 못했습니다 (${err.message}). 새로고침 후 다시 시도해 주세요.`
          : '비밀번호가 올바르지 않습니다.';
      $('lockErr').hidden = false;
    }
  });
  $('lockPw').focus();
}

async function init() {
  // 1) 암호화 데이터가 있으면 잠금 화면 (GitHub Pages 모드)
  try {
    const probe = await fetch('./data.enc', { method: 'HEAD', cache: 'no-store' });
    if (probe.ok) {
      showLock();
      return;
    }
  } catch { /* 로컬 폴백 */ }

  // 2) 없으면 평문 데이터 직접 로드 (로컬 개발 모드)
  try {
    const data = await loadPlainData();
    allItems = data.items || [];
    $('updatedAt').textContent = data.updatedAt
      ? `갱신: ${fmtDate(data.updatedAt)} (총 ${allItems.length}건)`
      : '갱신: —';
  } catch (e) {
    console.warn('데이터 로드 실패:', e.message);
    allItems = [];
    $('updatedAt').textContent = '갱신: — (데이터 없음)';
  }
  bindEvents();
  syncControls();
  render();
}

init();
