/**
 * encrypt.mjs — data/recruitments.json 을 SITE_PASSWORD 로 암호화해 site/data.enc 로 저장
 *
 * 형식: AES-256-GCM + PBKDF2(200,000회, SHA-256)
 * 브라우저(WebCrypto)에서 동일 방식으로 복호화 → 사이트가 비밀번호 없이는 열리지 않음.
 *
 * 사용법:  SITE_PASSWORD=비밀번호 node scripts/encrypt.mjs
 */
import { randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'recruitments.json');
const OUT = path.join(ROOT, 'site', 'data.enc');

const password = process.env.SITE_PASSWORD || '';
if (!password) {
  console.error('✗ SITE_PASSWORD 환경변수가 필요합니다.  SITE_PASSWORD=비밀번호 node scripts/encrypt.mjs');
  process.exit(1);
}

const plain = await readFile(SRC, 'utf8');

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, 200000, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

const out = {
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 200000 },
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ct: Buffer.concat([ct, tag]).toString('base64'),
};

await writeFile(OUT, JSON.stringify(out), 'utf8');
console.log(`✓ 암호화 완료: ${SRC} → ${OUT} (${plain.length} bytes → ${JSON.stringify(out).length} bytes)`);
