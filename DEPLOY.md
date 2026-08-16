# 무료 VPS(Oracle Cloud Always Free) 배포 가이드

목표: 노트북을 꺼도 24시간 돌아가는 수집기 + 나만 볼 수 있는(비공개) 웹사이트.

> 아직 세션 실험(capture/session-experiment.json) 결과에 따라 수집 주기/로그인 전략이
> 확정되지만, 배포 골격은 동일합니다.

---

## 1. Oracle Cloud 무료 VM 만들기

1. [cloud.oracle.com](https://cloud.oracle.com) 가입 (카드 등록 필요, 과금 없음)
2. **Create a VM instance**
   - Shape: **Ampere** → `VM.Standard.A1.Flex`, 4 OCPU / 24 GB RAM (Always Free 범위)
     - (E2.1-micro 는 RAM 1GB 라 Chromium 이 못 돎)
   - Image: **Ubuntu 22.04 or 24.04**
   - SSH 키: 내 공개키 등록 (없으면 `ssh-keygen` 으로 생성)
3. **Ingress 규칙** 추가 (Security List / VCN):
   - TCP 80 (HTTP), TCP 443 (HTTPS) 열기
   - SSH 22 는 기본으로 열려 있음

## 2. 서버 접속 + 프로젝트 올리기

```bash
ssh ubuntu@<서버IP>
sudo apt update && sudo apt install -y nodejs npm git
# Node 20 이상이 아니면:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs

git clone <내 저장소 주소> uwins-recruit && cd uwins-recruit
npm install
npx playwright install --with-deps chromium
```

> `--with-deps` 가 Chromium 구동에 필요한 시스템 라이브러리를 설치합니다.

## 3. 비밀번호/인증 설정

```bash
# 수집기 자동 로그인용 (비밀번호는 이 파일에만, 권한 600)
cat > .env <<'EOF'
UWINS_ID=내아이디
UWINS_PW=내비밀번호
SITE_USER=me
SITE_PASSWORD=사이트접속비밀번호
PORT=8080
EOF
chmod 600 .env
```

- `.env` 는 `.gitignore` 에 추가되어 저장소에 안 올라갑니다.
- **CAPTCHA 정책에 안 걸린 계정**이면 자동 로그인으로 동작합니다.
- CAPTCHA가 뜨는 계정이면: 아래 "수동 세션 복사" 참고.

## 4. 첫 로그인/수집 테스트

```bash
set -a && source .env && set +a
node scripts/scrape.mjs
cat data/recruitments.json | head
```

`✓ 완료: N건` 이 나오면 성공.

### (대안) 수동 세션 복사 — 자동 로그인이 CAPTCHA로 막힐 때

1. 내 Mac 에서 `npm run capture` 로 로그인 (브라우저 프로필에 세션 저장됨)
2. 프로필 압축 후 서버로 전송:
```bash
tar czf profile.tgz .browser-profile
scp profile.tgz ubuntu@<서버IP>:~/uwins-recruit/
# 서버에서: tar xzf profile.tgz
```
3. 세션 만료 전까지는 로그인 없이 수집됨 (30분 고정 만료 시 이 방법은 비효율 → 자동 로그인 필수)

## 5. 자동 실행 (systemd)

### 5-1. 사이트 서버 (상시)

```bash
sudo tee /etc/systemd/system/uwins-site.service <<'EOF'
[Unit]
Description=UWINS recruit site
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/uwins-recruit
EnvironmentFile=/home/ubuntu/uwins-recruit/.env
ExecStart=/usr/bin/node scripts/serve.mjs
Restart=always

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now uwins-site
```

### 5-2. 수집 데몬 (상시: 하트비트 + 60분 수집)

```bash
sudo tee /etc/systemd/system/uwins-daemon.service <<'EOF'
[Unit]
Description=UWINS recruit scraper daemon (heartbeat + hourly scrape)
After=network-online.target

[Service]
WorkingDirectory=/home/ubuntu/uwins-recruit
EnvironmentFile=/home/ubuntu/uwins-recruit/.env
ExecStart=/usr/bin/node scripts/daemon.mjs
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now uwins-daemon
```

- **10분마다** 페이지 새로고침(하트비트) → 30분 유휴 로그아웃 방지 (새로고침 시 30분 리셋 확인됨)
- **60분마다** 교내근로 + 국가근로 전 페이지 수집
- 세션 끊김 시 `.env` 의 `UWINS_ID/UWINS_PW` 로 자동 재로그인 (CAPTCHA 정책에 안 걸린 경우)

## 6. HTTPS + 공개 (선택: Caddy)

Basic 인증 비밀번호가 HTTP로 오가면 안 되므로, 외부 공개 전에 HTTPS 를 권장합니다.

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile <<'EOF'
recruit.내도메인.com {
    basicauth {
        me $2a$14$...   # caddy hash-password 로 생성
    }
    reverse_proxy localhost:8080
}
EOF
sudo systemctl reload caddy
```

- 도메인이 없으면 서버 IP + HTTPS 는 어렵고, 비밀번호 보호만으로 개인용으로 쓸 수 있습니다.
- 또는 Caddy 대신 `SITE_PASSWORD` 만 사용 (HTTP 경고 있음).

## 7. 점검 명령

```bash
systemctl status uwins-site uwins-daemon
journalctl -u uwins-daemon -n 20            # 수집/하트비트 로그
curl -I http://localhost:8080               # 사이트 응답 확인
```
