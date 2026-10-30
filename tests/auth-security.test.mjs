import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ADMIN_TOKEN = 'correct-secret';
const { clientIp, authenticate, requireAdmin, resetAuthThrottle } = await import('../src/server/services/auth.ts');

test('forged forwarding headers cannot manufacture new rate limit identities', () => {
  resetAuthThrottle();
  const request = (i) => new Request('https://x.test', { headers: { 'x-forwarded-for': `203.0.113.${i}`, 'x-real-ip': `192.0.2.${i}` } });
  for (let i = 1; i <= 12; i++) assert.throws(() => authenticate(request(i), 'wrong', '127.0.0.1'), (e) => e.status === 401);
  assert.throws(() => authenticate(request(13), 'correct-secret', '127.0.0.1'), (e) => e.status === 429);
  assert.equal(clientIp(request(1), '127.0.0.1'), clientIp(request(200), '127.0.0.1'));
  resetAuthThrottle();
});

test('direct peers use separate buckets and anonymous requests do not accumulate failures', () => {
  resetAuthThrottle();
  const req = new Request('https://x.test');
  for (let i = 0; i < 30; i++) assert.throws(() => requireAdmin(req, '192.0.2.1'), (e) => e.status === 401);
  authenticate(req, 'correct-secret', '192.0.2.1');
  assert.notEqual(clientIp(req, '192.0.2.1'), clientIp(req, '192.0.2.2'));
  assert.equal(clientIp(req, 'not-an-ip'), 'unknown');
  resetAuthThrottle();
});

test('bucket storage is bounded, global failures are limited, and windows expire', () => {
  resetAuthThrottle();
  const request = new Request('https://x.test');
  const originalNow = Date.now;
  let now = originalNow(); Date.now = () => now;
  try {
    for (let i = 0; i < 12; i++) assert.throws(() => authenticate(request, 'bad', '192.0.2.1'), (e) => e.status === 401);
    for (let i = 0; i < 1025; i++) {
      const peer = `10.0.${Math.floor(i / 256)}.${i % 256}`;
      assert.throws(() => authenticate(request, 'bad', peer), (e) => e.status === 401);
    }
    assert.doesNotThrow(() => authenticate(request, 'correct-secret', '192.0.2.1'), 'oldest bucket is evicted at capacity');
    for (let i = 0; i < 163; i++) {
      const peer = `10.10.${Math.floor(i / 256)}.${i % 256}`;
      assert.throws(() => authenticate(request, 'bad', peer), (e) => e.status === 401);
    }
    assert.throws(() => authenticate(request, 'correct-secret', '198.51.100.1'), (e) => e.status === 429, 'global bound limits churn');
    now += 10 * 60 * 1000 + 1;
    assert.doesNotThrow(() => authenticate(request, 'correct-secret', '198.51.100.1'));
  } finally { Date.now = originalNow; resetAuthThrottle(); }
});

test('concurrent failed logins cannot lose increments', async () => {
  resetAuthThrottle();
  const request = new Request('https://x.test');
  const attempts = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve().then(() => {
    try { authenticate(request, 'bad', '192.0.2.44'); return 200; } catch (e) { return e.status; }
  })));
  assert.ok(attempts.every((status) => status === 401));
  assert.throws(() => authenticate(request, 'correct-secret', '192.0.2.44'), (e) => e.status === 429);
  resetAuthThrottle();
});
