/**
 * serve.mjs — 의존성 없이 돌아가는 초경량 정적 서버 (선택적 비밀번호 보호)
 *
 * 프로젝트 루트를 서빙하며, "/" 접속 시 사이트(/site/)로 이동합니다.
 *
 * 사용법:
 *   npm run serve                                   → http://localhost:5173 (공개)
 *   SITE_PASSWORD=내비밀번호 npm run serve           → Basic 인증 걸린 비공개 모드
 *   PORT=8080 SITE_PASSWORD=... npm run serve       → 포트/비번 지정
 *
 * VPS 배포 시 SITE_PASSWORD 를 설정하면 "나만 보기"가 됩니다.
 * (HTTPS 는 앞단 프록시(Caddy/Nginx)에서 처리하는 것을 권장)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 5173);
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const AUTH_USER = process.env.SITE_USER || 'me';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 비밀번호는 평문 대신 SHA-256 해시로만 비교 (프로세스 내에서도 평문 유지 최소화)
const PASSWORD_HASH = SITE_PASSWORD
  ? crypto.createHash('sha256').update(`${AUTH_USER}:${SITE_PASSWORD}`).digest('hex')
  : null;

function checkAuth(req) {
  if (!PASSWORD_HASH) return true; // 비밀번호 미설정 = 공개
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8');
    const hash = crypto.createHash('sha256').update(decoded).digest('hex');
    const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(PASSWORD_HASH));
    return ok;
  } catch {
    return false;
  }
}

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="근로장학 채용", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('비밀번호가 필요합니다.');
    return;
  }

  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') {
      res.writeHead(302, { Location: '/site/' }).end();
      return;
    }
    if (urlPath === '/site' || urlPath === '/site/') urlPath = '/site/index.html';

    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: '/site/index.html' }).end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`✓ 사이트 실행 중 → http://localhost:${PORT}`);
  console.log(PASSWORD_HASH ? '  (비공개 모드 — SITE_PASSWORD 설정됨)' : '  (공개 모드 — SITE_PASSWORD 미설정)');
  console.log('  (종료: Ctrl+C)');
});
