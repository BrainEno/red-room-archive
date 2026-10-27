import { timingSafeEqual } from 'node:crypto';
import { env } from './notion.ts';
import { fail } from './http.ts';

/** 常量时间比较，避免通过响应时间猜测 token。 */
function sameSecret(a: string, b: string) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

export const tokenFrom = (r: Request) =>
  (r.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

export const authed = (r: Request) => {
  const expected = env('ADMIN_TOKEN');
  return !!expected && !!tokenFrom(r) && sameSecret(tokenFrom(r), expected);
};

export const deny = () => fail(401, 'Unauthorized');

// ── 登录失败节流：同一 IP 连续失败 N 次后短时间内直接 429，减缓暴力破解。
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 12;
const failures = new Map<string, { count: number; first: number }>();

export const clientIp = (r: Request) =>
  (r.headers.get('x-forwarded-for')?.split(',')[0] ?? r.headers.get('x-real-ip') ?? 'local').trim();

function bucket(ip: string) {
  const now = Date.now();
  const b = failures.get(ip);
  if (!b || now - b.first > WINDOW_MS) {
    const fresh = { count: 0, first: now };
    failures.set(ip, fresh);
    return fresh;
  }
  return b;
}

export const tooManyFailures = (r: Request) => {
  const b = failures.get(clientIp(r));
  return !!b && b.count >= MAX_FAILURES && Date.now() - b.first <= WINDOW_MS;
};

export const noteFailure = (r: Request) => {
  const b = bucket(clientIp(r));
  b.count++;
};

export const noteSuccess = (r: Request) => { failures.delete(clientIp(r)); };

/**
 * 所有受保护接口的统一入口：未授权 401；失败次数过多 429。
 * 返回 Response 表示应当直接结束请求。
 */
export function guard(r: Request): Response | null {
  if (tooManyFailures(r)) return fail(429, 'too many failed attempts, try again later');
  if (authed(r)) { noteSuccess(r); return null; }
  noteFailure(r);
  return deny();
}
