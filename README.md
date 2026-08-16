# 근로장학 채용 정리 (개인용)

울산대학교 근로장학 채용 메뉴(`uwins.ulsan.ac.kr` `MFA05U`)의 **교내근로 + 국가근로** 공고를
깔끔한 카드 목록으로 보여주는 개인용 도구입니다.

- 수집: 교내근로(2p) + 국가근로(7p), 총 ~90건
- 자동 갱신: **GitHub Actions** 3시간마다 → **GitHub Pages** 로 배포
- 비공개: 데이터는 **AES-256 암호화**(`site/data.enc`)로 저장, 사이트는 비밀번호를 입력해야 열림
- 배지: 모집중 / 오늘 마감 / D-n / NEW / 마감 · 근로구분별 분류, 토글 필터, 검색

> ⚠️ 개인용 도구입니다. 수집은 저빈도(3시간 1회)이고, 지원/신청 등 상태를 바꾸는 요청은 보내지 않습니다.
> CI에서 해외 IP로 주기적 로그인이 발생합니다. 계정에 보안문자(CAPTCHA)가 걸리면
> `DEPLOY.md` 의 VPS 방식(하트비트, 로그인 최소화)으로 전환하는 것을 권장합니다.

---

## 배포 구조 (GitHub Actions + Pages)

```
[3시간마다 GitHub Actions]
   → SSO 자동 로그인 (시크릿 UWINS_ID/UWINS_PW)
   → 교내+국가 전체 페이지 수집 → data/recruitments.json (런너에만 존재, 저장소에 안 올라감)
   → SITE_PASSWORD 로 AES-256-GCM 암호화 → site/data.enc 커밋
   → GitHub Pages 배포 → 비밀번호 입력해야 열리는 사이트
```

## 처음 셋업 (1회)

### 1) GitHub에 저장소 만들기

1. github.com → **New repository** → 이름 `uwins-recruit` → **Public** → Create
2. 이 프로젝트 폴더에서 (터미널):
```bash
cd /Users/apgx/Documents/DeepseekHRPR
git remote add origin https://github.com/<당신아이디>/uwins-recruit.git
git push -u origin main
```
> push 시 로그인 요구는 GitHub 웹 로그인/토큰으로 처리됩니다.
> (`gh` CLI가 있으면: `gh auth login` 후 `gh repo create uwins-recruit --public --source . --push` 한 방에 끝남)

### 2) 시크릿 3개 등록 (내 비밀번호 — 저장소에는 절대 안 올라감)

github.com → 저장소 → **Settings → Secrets and variables → Actions → New repository secret**:

| 이름 | 값 |
|---|---|
| `UWINS_ID` | UWINS 아이디 |
| `UWINS_PW` | UWINS 비밀번호 |
| `SITE_PASSWORD` | 사이트 열람용 비밀번호 (아무거나 정하세요) |

### 3) Pages 켜기

저장소 → **Settings → Pages → Source: GitHub Actions** 선택 (자동으로 적용됨)

### 4) 첫 실행

저장소 → **Actions 탭 → "scrape-and-publish" → Run workflow**

- 3~5분 후 완료되면 사이트 주소: **https://<당신아이디>.github.io/uwins-recruit/**
- `SITE_PASSWORD` 를 입력하면 목록이 보입니다
- 이후로는 3시간마다 자동 갱신 (Actions 탭에서 수동 실행도 가능)

## 로컬 개발

```bash
npm run serve                       # http://localhost:5173
node scripts/scrape.mjs --login     # 1회 수동 로그인 + 수집
SITE_PASSWORD=test node scripts/encrypt.mjs   # 로컬에서 암호화본 생성
```

## 스크립트

| 명령 | 역할 |
|---|---|
| `scripts/scrape.mjs` | 1회 수집 (세션 없으면 `--login` 수동 / `UWINS_ID·UWINS_PW` 자동) |
| `scripts/encrypt.mjs` | 데이터 암호화 → `site/data.enc` |
| `scripts/daemon.mjs` | VPS 상시 데몬 (하트비트 10분 + 수집 60분) — `DEPLOY.md` 참고 |
| `scripts/serve.mjs` | 로컬 정적 서버 |
| `scripts/capture.mjs` | 수동 로그인 화면/네트워크 캡처 (디버깅) |

## 데이터 형식

```json
{
  "updatedAt": "2026-08-16T...",
  "items": [
    {
      "id": "2026200116",
      "title": "주거환경학전공사무실",
      "department": "2026-2학기 실내건축학트랙 국가근로 모집",
      "category": "국가근로",
      "period": "2026.09.01 ~ 2027.02.19",
      "hours": "9시~18시",
      "recruitRange": "2026.08.10 ~ 2026.08.16",
      "deadline": "2026-08-16",
      "postedAt": "2026-08-16",
      "status": "모집중",
      "url": "https://uwins.ulsan.ac.kr/SCHO/A/MFA05U.aspx?MenuID=MFA05U!1"
    }
  ]
}
```
