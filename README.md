# 근로장학 채용 정리 (개인용)

울산대학교 근로장학 채용 메뉴(`uwins.ulsan.ac.kr` `MFA05U`)의 **교내근로 + 국가근로** 공고를
깔끔한 카드 목록으로 보여주는 개인용 도구입니다.

- 수집 대상: 교내근로(2p) + 국가근로(7p) 전체, 총 ~90건
- 배지: `모집중` / `오늘 마감` / `D-n` / `NEW` / `마감`
- 검색·필터(모집중만/마감 숨김), 마감순 정렬

> ⚠️ 개인용 도구입니다. 수집은 저빈도(1시간 1회)로, 지원/신청 등 상태를 바꾸는 요청은 보내지 않습니다.

---

## 구조

```
[UWINS(로그인 필요)] ─▶ scrape/daemon ─▶ data/recruitments.json ─▶ site/(정적 사이트) ─▶ serve
                        │ 10분 하트비트(세션 유지)
                        │ 60분 전체 수집
```

- 세션: 새로고침마다 30분 유휴 로그아웃 타이머가 리셋됨 → 10분 간격 하트비트로 상시 유지
- 사이트: `scripts/serve.mjs` (의존성 없는 정적 서버, `SITE_PASSWORD` 설정 시 비공개)

## 스크립트

| 명령 | 역할 |
|---|---|
| `node scripts/capture.mjs` | 로컬 1회 수동 로그인 + 화면/네트워크 캡처 (디버깅용) |
| `node scripts/scrape.mjs` | 1회 수집. 세션 없으면 `--login`(수동) 또는 `UWINS_ID/UWINS_PW`(자동) |
| `node scripts/daemon.mjs` | **상시 데몬**: 하트비트(10분) + 전체 수집(60분) + 자동 재로그인 |
| `node scripts/serve.mjs` | 사이트 서버 (로컬: `npm run serve` → http://localhost:5173) |
| `node scripts/probe-session.mjs` | 세션 상태 진단 |

## VPS 배포

무료 VPS(Oracle Always Free)에서 24시간 돌리는 방법: **`DEPLOY.md`** 참고.

핵심만:
```bash
# 서버에서
npm install && npx playwright install --with-deps chromium
cat > .env <<'EOF'    # chmod 600 (저장소에 안 올라감)
UWINS_ID=아이디
UWINS_PW=비밀번호
SITE_PASSWORD=사이트비밀번호
PORT=8080
EOF
sudo systemctl enable --now uwins-daemon uwins-site   # DEPLOY.md 의 유닛 사용
```

## 데이터 형식 (`data/recruitments.json`)

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
