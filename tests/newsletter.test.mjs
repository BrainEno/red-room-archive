// Newsletter: double opt-in, tokens, unsubscribe, admin list/CSV, both
// storage engines (SQLite and the encrypted Netlify Blobs document), the
// email adapters and the HTTP surface (Node endpoint == Netlify Function).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.SITE_URL = 'https://archive.example';
const SECRET = 'n'.repeat(40);
const CONFIGURED = {
  NEWSLETTER_SECRET: SECRET,
  NEWSLETTER_EMAIL_PROVIDER: 'resend',
  NEWSLETTER_EMAIL_API_KEY: 're_test_key_not_real',
  NEWSLETTER_FROM: 'Red Room <letters@archive.example>',
};
const configure = (on = true) => {
  for (const [key, value] of Object.entries(CONFIGURED)) {
    if (on) process.env[key] = value;
    else delete process.env[key];
  }
};
configure();

const core = await import('../src/core/newsletter.ts');
const { createNewsletterService, NEWSLETTER_LIMITS } = await import('../src/server/services/newsletter.ts');
const { newsletterConfig, parseSender } = await import('../src/server/newsletter/config.ts');
const { createDocumentStore, memoryBackend, blobsBackend } = await import('../src/server/newsletter/document-store.ts');
const { seal, unseal, hashToken, unsubscribeToken } = await import('../src/server/newsletter/crypto.ts');
const { DuplicateSubscriberError } = await import('../src/server/newsletter/store.ts');
const { sqliteNewsletterStore } = await import('../src/server/db/newsletter.repository.ts');
const { connection, closeConnection } = await import('../src/server/db/connection.ts');
const { handleNewsletterRequest } = await import('../src/server/newsletter/http.ts');
const { netlifyNewsletterService, documentKey } = await import('../src/server/newsletter/netlify.ts');
const { resendMailer, brevoMailer } = await import('../src/server/newsletter/mailer.ts');
const endpoint = await import('../src/server/http/endpoints/newsletter.ts');
const { resetAuthThrottle } = await import('../src/server/services/auth.ts');

test.after(() => closeConnection());
test.beforeEach(() => {
  resetAuthThrottle();
  configure();
});

/* ── helpers ─────────────────────────────────────────────────────────── */

const clock = (start = '2026-10-30T08:00:00.000Z') => {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms) => { t += ms; } };
};

const fakeMailer = () => {
  const sent = [];
  let failures = 0;
  return {
    sent,
    failNext: (n = 1) => { failures = n; },
    mailer: {
      provider: 'test',
      async send(message) {
        if (failures > 0) { failures--; throw new Error('provider down (HTTP 503)'); }
        sent.push(message);
      },
    },
  };
};

const tokenFrom = (message) => /#token=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
const unsubscribeFrom = (message) => /#token=([0-9a-z]+\.[A-Za-z0-9_-]{43})/.exec(message.text)?.[1];

function memoryService(options = {}) {
  const c = options.clock ?? clock();
  const mail = options.mail ?? fakeMailer();
  const backend = options.backend ?? memoryBackend();
  const store = createDocumentStore(backend, { encode: (s) => seal(SECRET, s), decode: (s) => unseal(SECRET, s) }, 'memory');
  const config = { ...newsletterConfig(), ...(options.config ?? {}) };
  const logs = [];
  const service = createNewsletterService({ store, storage: 'netlify-blobs', config, mailer: mail.mailer, now: c.now, log: (event, fields) => logs.push([event, fields]) });
  return { service, mail, clock: c, backend, store, logs };
}

const client = (ip = '203.0.113.7') => ({ ip });

/* ── core ────────────────────────────────────────────────────────────── */

test('addresses are validated and normalised', () => {
  assert.deepEqual(core.normalizeEmail('  Reader.One+news@Example.COM '), { email: 'Reader.One+news@example.com', normalized: 'reader.one+news@example.com' });
  assert.equal(core.normalizeEmail('a@bücher.example')?.email, 'a@xn--bcher-kva.example');
  for (const bad of ['', 'plain', '@x.com', 'a@', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.c', 'a@-b.com', 'a@b-.com', 'a@1.2.3.4', 'a@[::1]',
    'a@example.com:25', 'a@example.com/x', '"q"@example.com', 'a..b@example.com', '.a@example.com', 'a@example..com', `${'x'.repeat(65)}@example.com`,
    `a@${'b'.repeat(250)}.com`, 'a@example.com\r\nBcc: x@y.com', 'ä@example.com', 42, null, undefined, {}]) {
    assert.equal(core.normalizeEmail(bad), null, JSON.stringify(bad));
  }
  assert.equal(core.maskEmail('reader@example.com'), 'r•••@example.com');
});

test('CSV cells cannot become spreadsheet formulas', () => {
  assert.equal(core.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  for (const lead of ['+', '-', '@', '\t', '\r']) assert.ok(core.csvCell(`${lead}1`).replace(/^"/, '').startsWith(`'${lead}`), JSON.stringify(lead));
  assert.equal(core.csvCell('a,b'), '"a,b"');
  assert.equal(core.csvCell(null), '');
  assert.equal(core.toCsv(['a', 'b'], [[1, '=2']]), "a,b\r\n1,'=2\r\n");
});

test('configuration lists exactly what is missing and never enables half-configured delivery', () => {
  configure(false);
  const empty = newsletterConfig();
  assert.equal(empty.enabled, false);
  assert.deepEqual(empty.missing, ['NEWSLETTER_SECRET', 'NEWSLETTER_EMAIL_PROVIDER', 'NEWSLETTER_EMAIL_API_KEY', 'NEWSLETTER_FROM']);
  configure();
  assert.equal(newsletterConfig().enabled, true);
  assert.equal(newsletterConfig((k) => ({ ...CONFIGURED, NEWSLETTER_SECRET: 'short', SITE_URL: 'https://a.example' })[k]).missing.join(), 'NEWSLETTER_SECRET');
  assert.equal(newsletterConfig((k) => ({ ...CONFIGURED, SITE_URL: 'https://a.example/path' })[k]).missing.join(), 'SITE_URL');
  assert.equal(newsletterConfig((k) => ({ ...CONFIGURED, NETLIFY: 'true', URL: 'https://site.netlify.app' })[k]).siteUrl, 'https://site.netlify.app');
  assert.deepEqual(parseSender('Red Room <letters@archive.example>'), { name: 'Red Room', email: 'letters@archive.example' });
  assert.deepEqual(parseSender('letters@archive.example'), { name: '', email: 'letters@archive.example' });
  assert.equal(parseSender('Evil\r\nBcc: x <a@b.com>'), null);
  assert.equal(parseSender('Name <not-an-address>'), null);
});

/* ── SQLite engine ───────────────────────────────────────────────────── */

test('migration 11 creates the newsletter tables with unique keys', () => {
  const db = connection();
  assert.ok(Number(db.pragma('user_version', { simple: true })) >= 11);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'newsletter_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['newsletter_rate_limits', 'newsletter_send_log', 'newsletter_subscribers', 'newsletter_tokens']);
  const columns = db.prepare('PRAGMA table_info(newsletter_tokens)').all().map((c) => c.name);
  assert.ok(columns.includes('token_hash') && !columns.includes('token'), 'only hashes are stored');
});

const newRow = (normalized, at = '2026-10-30T08:00:00.000Z') => ({
  email: normalized, normalizedEmail: normalized, status: 'pending', source: 'test', locale: 'en', createdAt: at, updatedAt: at,
  confirmedAt: null, unsubscribedAt: null, lastError: null, lastErrorAt: null, noticeSentAt: null,
});

for (const [name, makeStore] of [
  ['sqlite', () => sqliteNewsletterStore],
  ['document', () => createDocumentStore(memoryBackend(), { encode: (s) => s, decode: (s) => s }, 'memory')],
]) {
  test(`${name} store: uniqueness, single-use tokens and rollback`, async () => {
    const store = makeStore();
    const address = `unique-${name}@example.com`;
    const row = await store.transact((tx) => tx.insertSubscriber(newRow(address)));
    await assert.rejects(store.transact((tx) => tx.insertSubscriber(newRow(address))), DuplicateSubscriberError);

    const token = await store.transact((tx) => tx.insertToken({ subscriberId: row.id, tokenHash: hashToken(`t-${name}`), tokenType: 'confirm', expiresAt: '2026-11-01T00:00:00.000Z', consumedAt: null, createdAt: '2026-10-30T08:00:00.000Z' }));
    assert.equal(await store.transact((tx) => tx.consumeToken(token.id, '2026-10-30T09:00:00.000Z')), true);
    assert.equal(await store.transact((tx) => tx.consumeToken(token.id, '2026-10-30T09:00:01.000Z')), false, 'a token is used once');

    // A throw inside the transaction commits nothing.
    await assert.rejects(store.transact((tx) => {
      tx.updateSubscriber(row.id, { status: 'active' });
      tx.insertSubscriber(newRow(`rollback-${name}@example.com`));
      throw new Error('boom');
    }), /boom/);
    const after = await store.transact((tx) => ({ row: tx.findSubscriber(row.id), other: tx.findSubscriberByEmail(`rollback-${name}@example.com`) }));
    assert.equal(after.row.status, 'pending');
    assert.equal(after.other, undefined);

    // Search escapes LIKE wildcards; filter by status; counts.
    await store.transact((tx) => tx.insertSubscriber({ ...newRow(`a_b-${name}@example.com`), status: 'active' }));
    const like = await store.transact((tx) => tx.listSubscribers({ q: `a_b-${name}`, limit: 10, offset: 0 }));
    assert.deepEqual(like.rows.map((r) => r.email), [`a_b-${name}@example.com`]);
    const wildcard = await store.transact((tx) => tx.listSubscribers({ q: '%', limit: 10, offset: 0 }));
    assert.equal(wildcard.total, 0);
    const counts = await store.transact((tx) => tx.counts());
    assert.ok(counts.total >= 2 && counts.active >= 1 && counts.pending >= 1);

    // Daily budget and rate windows.
    assert.equal(await store.transact((tx) => tx.reserveSend(`2026-10-${name.length}`, 1)), true);
    assert.equal(await store.transact((tx) => tx.reserveSend(`2026-10-${name.length}`, 1)), false);
    assert.equal(await store.transact((tx) => [tx.hitRateLimit(`k-${name}`, 2, 1000, 0), tx.hitRateLimit(`k-${name}`, 2, 1000, 1), tx.hitRateLimit(`k-${name}`, 2, 1000, 2)].join()), 'true,true,false');
    assert.equal(await store.transact((tx) => tx.hitRateLimit(`k-${name}`, 2, 1000, 1001)), true, 'a new window starts');
  });
}

/* ── document store: optimistic concurrency + encryption ─────────────── */

test('document store retries on a lost race and never loses a write', async () => {
  const backend = memoryBackend();
  const store = createDocumentStore(backend, { encode: (s) => s, decode: (s) => s }, 'memory');
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.transact((tx) => tx.insertSubscriber(newRow(`race-${i}@example.com`)))));
  const counts = await store.transact((tx) => tx.counts());
  assert.equal(counts.total, 12);
  const ids = await store.transact((tx) => tx.allSubscribers({}).map((r) => r.id).sort((a, b) => a - b));
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => i + 1));
});

test('document store: reads skip the write; sealed data needs the secret and is never overwritten', async () => {
  const backend = memoryBackend();
  const sealed = createDocumentStore(backend, { encode: (s) => seal(SECRET, s), decode: (s) => unseal(SECRET, s) }, 'memory');
  await sealed.transact((tx) => tx.insertSubscriber(newRow('secret@example.com')));
  assert.equal(backend.writes, 1);
  await sealed.transact((tx) => tx.counts());
  assert.equal(backend.writes, 1, 'read-only transactions do not write');
  assert.doesNotMatch(backend.text(), /secret@example\.com/, 'addresses are encrypted at rest');
  const wrong = createDocumentStore(backend, { encode: (s) => seal('w'.repeat(40), s), decode: (s) => unseal('w'.repeat(40), s) }, 'memory');
  await assert.rejects(wrong.transact((tx) => tx.insertSubscriber(newRow('x@example.com'))), /cannot be decrypted/);
  assert.equal(backend.writes, 1, 'an unreadable document is left untouched');
});

test('Netlify Blobs backend uses strong reads and ETag-conditional writes', async () => {
  const calls = [];
  let stored = null;
  const blobs = {
    async getWithMetadata(key, options) { calls.push(['get', key, options]); return stored && { data: stored.data, etag: stored.etag, metadata: {} }; },
    async set(key, value, options) {
      calls.push(['set', key, options]);
      if (options.onlyIfNew && stored) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== stored?.etag) return { modified: false };
      stored = { data: value, etag: `"e${calls.length}"` };
      return { modified: true, etag: stored.etag };
    },
  };
  const backend = blobsBackend(blobs, 'k');
  assert.equal(await backend.load(), null);
  assert.equal(await backend.save('one', null), true);
  assert.equal(await backend.save('two', null), false, 'onlyIfNew refuses to clobber');
  const loaded = await backend.load();
  assert.equal(await backend.save('three', '"stale"'), false);
  assert.equal(await backend.save('three', loaded.etag), true);
  assert.deepEqual(calls[0], ['get', 'k', { type: 'text', consistency: 'strong' }]);
  assert.deepEqual(calls.filter((c) => c[0] === 'set').map((c) => c[2]), [{ onlyIfNew: true }, { onlyIfNew: true }, { onlyIfMatch: '"stale"' }, { onlyIfMatch: loaded.etag }]);
  assert.equal(documentKey('deploy-preview'), 'subscribers-deploy-preview.json');
  assert.equal(documentKey(undefined), 'subscribers-production.json');
  assert.equal(documentKey('../../x'), 'subscribers-x.json');
});

/* ── service: double opt-in ──────────────────────────────────────────── */

test('subscribe creates a pending row and emails a single-use, expiring token; confirm activates', async () => {
  const { service, mail, backend } = memoryService();
  assert.deepEqual(await service.subscribe({ email: 'Reader@Example.com', locale: 'zh-CN', source: 'Article!!' }, client()), { status: 'check-inbox' });
  let list = await service.list();
  assert.equal(list.subscribers[0].status, 'pending', 'never active before confirmation');
  assert.equal(list.subscribers[0].source, 'article');
  assert.equal(list.subscribers[0].locale, 'zh-CN');
  assert.equal(mail.sent.length, 1);
  const message = mail.sent[0];
  assert.equal(message.to, 'Reader@example.com');
  assert.match(message.subject, /确认订阅/);
  assert.match(message.text, /https:\/\/archive\.example\/zh-CN\/newsletter\/confirm#token=/);
  assert.equal(message.headers, undefined, 'no List-Unsubscribe before the reader is subscribed');
  const token = tokenFrom(message);
  assert.ok(token);
  assert.doesNotMatch(unseal(SECRET, backend.text()), new RegExp(token), 'the token itself is never stored');
  assert.match(unseal(SECRET, backend.text()), new RegExp(hashToken(token)));

  assert.deepEqual(await service.confirm(token), { status: 'confirmed' });
  list = await service.list();
  assert.equal(list.subscribers[0].status, 'active');
  assert.ok(list.subscribers[0].confirmedAt);
  assert.deepEqual(await service.confirm(token), { status: 'already-confirmed' }, 'a second click is harmless');

  const welcome = mail.sent[1];
  assert.match(welcome.subject, /已订阅/);
  assert.match(welcome.headers['List-Unsubscribe'], /^<https:\/\/archive\.example\/api\/newsletter\/unsubscribe\?token=[0-9a-z]+\.[A-Za-z0-9_-]{43}>$/);
  assert.equal(welcome.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('confirmation links are rejected when invalid, expired or replaced', async () => {
  const c = clock();
  const { service, mail } = memoryService({ clock: c });
  for (const bad of ['', 'short', 'x'.repeat(43), null, 7]) {
    await assert.rejects(service.confirm(bad), (e) => e.status === 400 && e.details.reason === 'invalid', String(bad));
  }
  await service.subscribe({ email: 'late@example.com' }, client());
  const first = tokenFrom(mail.sent[0]);
  c.advance(48 * 60 * 60 * 1000 + 1);
  await assert.rejects(service.confirm(first), (e) => e.status === 410 && e.details.reason === 'expired');
  assert.equal((await service.list()).subscribers[0].status, 'pending');

  // Asking again issues a fresh token and retires the old one.
  await service.subscribe({ email: 'late@example.com' }, client());
  const second = tokenFrom(mail.sent[1]);
  assert.notEqual(second, first);
  await assert.rejects(service.confirm(first), (e) => e.status === 400 || e.status === 410);
  assert.deepEqual(await service.confirm(second), { status: 'confirmed' });
});

test('responses never reveal whether an address is known; repeats are throttled per address', async () => {
  const c = clock();
  const { service, mail } = memoryService({ clock: c });
  const ok = { status: 'check-inbox' };
  assert.deepEqual(await service.subscribe({ email: 'dup@example.com' }, client('198.51.100.1')), ok);
  assert.deepEqual(await service.subscribe({ email: 'DUP@example.com' }, client('198.51.100.2')), ok, 'pending: same answer');
  assert.equal(mail.sent.length, 1, 'no second email inside the cooldown');
  assert.equal((await service.list()).total, 1, 'one row per normalised address');

  await service.confirm(tokenFrom(mail.sent[0]));
  const before = mail.sent.length;
  assert.deepEqual(await service.subscribe({ email: 'dup@example.com' }, client('198.51.100.3')), ok, 'active: same answer');
  assert.equal(mail.sent.length, before + 1);
  assert.match(mail.sent.at(-1).subject, /already subscribed/);
  assert.deepEqual(await service.subscribe({ email: 'dup@example.com' }, client('198.51.100.4')), ok);
  assert.equal(mail.sent.length, before + 1, 'at most one "already subscribed" note per day');

  // Per-address daily cap on confirmation emails.
  const { service: s2, mail: m2, clock: c2 } = memoryService();
  for (let i = 0; i < 8; i++) {
    await s2.subscribe({ email: 'cap@example.com' }, client(`192.0.2.${i}`));
    c2.advance(NEWSLETTER_LIMITS.confirmCooldownMs + 1);
  }
  assert.equal(m2.sent.length, NEWSLETTER_LIMITS.confirmPerDay);
});

test('per-client rate limit and the site-wide daily budget', async () => {
  const { service } = memoryService();
  for (let i = 0; i < NEWSLETTER_LIMITS.clientMax; i++) await service.subscribe({ email: `r${i}@example.com` }, client('203.0.113.50'));
  await assert.rejects(service.subscribe({ email: 'one-more@example.com' }, client('203.0.113.50')), (e) => e.status === 429);
  assert.deepEqual(await service.subscribe({ email: 'other@example.com' }, client('203.0.113.51')), { status: 'check-inbox' });

  const { service: capped, mail } = memoryService({ config: { dailyLimit: 2 } });
  await capped.subscribe({ email: 'a@example.com' }, client('1.1.1.1'));
  await capped.subscribe({ email: 'b@example.com' }, client('1.1.1.2'));
  await assert.rejects(capped.subscribe({ email: 'c@example.com' }, client('1.1.1.3')), (e) => e.status === 503 && /daily email limit/.test(e.message));
  assert.equal(mail.sent.length, 2);
  assert.equal((await capped.list()).total, 2, 'nothing saved when the budget is spent');
  assert.equal((await capped.delivery()).sentToday, 2);
});

test('honeypot submissions are dropped without storing or sending', async () => {
  const { service, mail } = memoryService();
  assert.deepEqual(await service.subscribe({ email: 'bot@example.com', website: 'http://spam' }, client()), { status: 'check-inbox' });
  assert.equal(mail.sent.length, 0);
  assert.equal((await service.list()).total, 0);
});

test('without email configuration nothing is stored and the answer says so', async () => {
  const { service, mail } = memoryService({ config: { enabled: false, missing: ['NEWSLETTER_EMAIL_API_KEY'] } });
  assert.deepEqual(service.availability(), { enabled: false });
  await assert.rejects(service.subscribe({ email: 'x@example.com' }, client()), (e) => e.status === 503 && /not configured/.test(e.message) && /Nothing was saved/.test(e.message));
  assert.equal(mail.sent.length, 0);
  assert.equal((await service.list()).total, 0);
  const delivery = (await service.list()).delivery;
  assert.equal(delivery.configured, false);
  assert.deepEqual(delivery.missing, ['NEWSLETTER_EMAIL_API_KEY']);
});

test('a failed send activates nothing, records the failure, and can be retried at once', async () => {
  const { service, mail, logs } = memoryService();
  mail.failNext();
  await assert.rejects(service.subscribe({ email: 'flaky@example.com' }, client()), (e) => e.status === 502 && /Nothing was activated/.test(e.message));
  let row = (await service.list()).subscribers[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.lastError, 'send_failed');
  assert.deepEqual(await service.subscribe({ email: 'flaky@example.com' }, client()), { status: 'check-inbox' }, 'no cooldown after a failed send');
  row = (await service.list()).subscribers[0];
  assert.equal(row.lastError, null);
  await service.confirm(tokenFrom(mail.sent[0]));
  const text = JSON.stringify(logs);
  assert.doesNotMatch(text, /flaky@example\.com/, 'logs never contain the full address');
  assert.doesNotMatch(text, new RegExp(tokenFrom(mail.sent[0])), 'logs never contain tokens');

  // Admin recovery path for pending rows.
  const { service: s2, mail: m2 } = memoryService();
  m2.failNext();
  await assert.rejects(s2.subscribe({ email: 'stuck@example.com' }, client()));
  const id = (await s2.list()).subscribers[0].id;
  assert.deepEqual(await s2.resend(id), { status: 'sent' });
  assert.deepEqual(await s2.confirm(tokenFrom(m2.sent[0])), { status: 'confirmed' });
  await assert.rejects(s2.resend(id), (e) => e.status === 409);
  await assert.rejects(s2.resend(999), (e) => e.status === 404);
});

test('unsubscribe is token-bound, idempotent, keeps history and needs a new confirmation to return', async () => {
  const { service, mail } = memoryService();
  await service.subscribe({ email: 'leaver@example.com' }, client());
  await service.confirm(tokenFrom(mail.sent[0]));
  const token = unsubscribeFrom(mail.sent[1]);
  assert.ok(token);
  await assert.rejects(service.unsubscribe(token.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'))), (e) => e.status === 400);
  await assert.rejects(service.unsubscribe(unsubscribeToken('o'.repeat(40), 1, 'leaver@example.com')), (e) => e.status === 400, 'other secret');
  await assert.rejects(service.unsubscribe('1.short'), (e) => e.status === 400);
  assert.deepEqual(await service.unsubscribe(token), { status: 'unsubscribed' });
  assert.deepEqual(await service.unsubscribe(token), { status: 'unsubscribed' }, 'idempotent');
  let row = (await service.list()).subscribers[0];
  assert.equal(row.status, 'unsubscribed');
  assert.ok(row.confirmedAt && row.unsubscribedAt, 'history is kept');
  await assert.rejects(service.confirm(tokenFrom(mail.sent[0])), (e) => e.status === 400, 'an old confirmation link cannot re-subscribe');

  const sentBefore = mail.sent.length;
  await service.subscribe({ email: 'leaver@example.com' }, client());
  row = (await service.list()).subscribers[0];
  assert.equal(row.status, 'unsubscribed', 'signing up again is not enough');
  assert.equal(mail.sent.length, sentBefore + 1);
  await service.confirm(tokenFrom(mail.sent.at(-1)));
  assert.equal((await service.list()).subscribers[0].status, 'active');
});

test('admin list: counts, search, filter, paging; CSV has minimal, injection-safe fields', async () => {
  const { service, mail } = memoryService();
  for (const [i, email] of ['alpha@example.com', 'beta@example.org', '=cmd@example.com'].entries()) {
    await service.subscribe({ email }, client(`10.0.0.${i}`));
  }
  await service.confirm(tokenFrom(mail.sent[0]));
  const all = await service.list();
  assert.deepEqual(all.counts, { total: 3, active: 1, pending: 2, unsubscribed: 0 });
  assert.equal((await service.list({ q: 'EXAMPLE.ORG' })).total, 1);
  assert.equal((await service.list({ status: 'active' })).subscribers[0].email, 'alpha@example.com');
  assert.equal((await service.list({ limit: 1, offset: 1 })).subscribers.length, 1);
  await assert.rejects(service.list({ status: 'vip' }), (e) => e.status === 400);
  for (const row of all.subscribers) {
    assert.deepEqual(Object.keys(row).sort(), ['confirmedAt', 'createdAt', 'email', 'id', 'lastError', 'lastErrorAt', 'locale', 'source', 'status', 'unsubscribedAt']);
  }
  const { csv, filename } = await service.exportCsv();
  assert.match(filename, /^newsletter-subscribers-\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, ...lines] = csv.trim().split('\r\n');
  assert.equal(header, 'email,status,locale,source,created_at,confirmed_at,unsubscribed_at');
  assert.equal(lines.length, 3);
  assert.ok(lines.some((line) => line.startsWith("'=cmd@example.com")), 'formula prefix neutralised');
  assert.doesNotMatch(csv, /hash|token|secret/i);
  assert.equal((await service.exportCsv({ status: 'active' })).csv.trim().split('\r\n').length, 2);
});

/* ── HTTP: Node endpoint (SQLite) ────────────────────────────────────── */

const sentMail = [];
const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.resend.com/emails') {
      sentMail.push({ headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });
      return Response.json({ id: 'email_1' });
    }
    return realFetch(url, init);
  };
});
test.after(() => { globalThis.fetch = realFetch; });

async function call(method, path, { body, json = true, headers = {}, admin = false, ip = '203.0.113.9' } = {}) {
  const url = new URL(path, 'https://archive.example');
  const h = new Headers(headers);
  if (json && body !== undefined) h.set('content-type', 'application/json');
  if (admin) h.set('authorization', `Bearer ${admin === true ? 'test-admin-token' : admin}`);
  const request = new Request(url, { method, headers: h, body: body === undefined ? undefined : (json ? JSON.stringify(body) : body), duplex: 'half', redirect: 'manual' });
  const response = await endpoint.newsletter({ request, url, params: {}, clientAddress: ip });
  const type = response.headers.get('content-type') ?? '';
  const raw = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, raw, data: type.includes('json') ? JSON.parse(raw.toString('utf8')) : raw.toString('utf8') };
}

test('HTTP: subscribe → email → confirm → unsubscribe (one-click) on the Node server', async () => {
  sentMail.length = 0;
  assert.deepEqual((await call('GET', '/api/newsletter/status')).data, { enabled: true });
  const sub = await call('POST', '/api/newsletter/subscribe', { body: { email: 'http@example.com', locale: 'en', source: 'subscribe-page' } });
  assert.equal(sub.status, 202);
  assert.equal(sub.headers.get('cache-control'), 'no-store');
  assert.equal(sentMail.length, 1);
  const { headers, body } = sentMail[0];
  assert.equal(headers.authorization, 'Bearer re_test_key_not_real');
  assert.equal(body.from, 'Red Room <letters@archive.example>');
  assert.deepEqual(body.to, ['http@example.com']);
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(body.text)[1];

  assert.equal((await call('POST', '/api/newsletter/confirm', { body: { token: 'x'.repeat(43) } })).status, 400);
  const confirmed = await call('POST', '/api/newsletter/confirm', { body: { token } });
  assert.deepEqual([confirmed.status, confirmed.data], [200, { status: 'confirmed' }]);
  assert.deepEqual((await call('POST', '/api/newsletter/confirm', { body: { token } })).data, { status: 'already-confirmed' });

  const welcome = sentMail[1].body;
  assert.equal(welcome.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  const oneClick = /<([^>]+)>/.exec(welcome.headers['List-Unsubscribe'])[1];
  const path = new URL(oneClick).pathname + new URL(oneClick).search;

  const redirect = await call('GET', path);
  assert.equal(redirect.status, 303, 'GET never unsubscribes');
  assert.match(redirect.headers.get('location'), /^\/newsletter\/unsubscribe#token=/);
  assert.equal((await call('POST', path, { body: 'nope=1', json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 400);
  const done = await call('POST', path, { body: 'List-Unsubscribe=One-Click', json: false, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://mail.example' } });
  assert.deepEqual([done.status, done.data], [200, { status: 'unsubscribed' }]);
  const again = await call('POST', '/api/newsletter/unsubscribe', { body: { token: new URL(oneClick).searchParams.get('token') } });
  assert.deepEqual(again.data, { status: 'unsubscribed' });

  const row = connection().prepare("SELECT status, confirmed_at, unsubscribed_at FROM newsletter_subscribers WHERE normalized_email = 'http@example.com'").get();
  assert.equal(row.status, 'unsubscribed');
  assert.ok(row.confirmed_at && row.unsubscribed_at);
  const stored = JSON.stringify(connection().prepare('SELECT * FROM newsletter_tokens').all());
  assert.doesNotMatch(stored, new RegExp(token));
});

test('HTTP: CSRF guards and input validation', async () => {
  const formPost = await call('POST', '/api/newsletter/subscribe', { body: 'email=a%40b.com', json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(formPost.status, 400, 'a cross-site HTML form cannot subscribe anyone');
  assert.equal((await call('POST', '/api/newsletter/subscribe', { body: { email: 'a@example.com' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/newsletter/subscribe', { body: { email: 'a@example.com' }, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await call('POST', '/api/newsletter/subscribe', { body: { email: 'a@example.com' }, headers: { origin: 'https://archive.example', 'sec-fetch-site': 'same-origin' } })).status, 202);
  const invalid = await call('POST', '/api/newsletter/subscribe', { body: { email: 'not-an-email' } });
  assert.deepEqual([invalid.status, invalid.data.code, invalid.data.details], [400, 'bad_request', { field: 'email' }]);
  assert.equal((await call('POST', '/api/newsletter/subscribe', { body: { email: 'x'.repeat(5000) } })).status, 413);
  assert.equal((await call('GET', '/api/newsletter/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/newsletter/subscribe')).status, 404);
});

test('HTTP: admin endpoints need the admin token; CSV excludes secrets', async () => {
  for (const path of ['/api/newsletter/admin/subscribers', '/api/newsletter/admin/export']) {
    assert.equal((await call('GET', path)).status, 401);
    assert.equal((await call('GET', path, { admin: 'wrong-token' })).status, 401);
  }
  assert.equal((await call('POST', '/api/newsletter/admin/subscribers/1/resend')).status, 401);
  const list = await call('GET', '/api/newsletter/admin/subscribers?status=unsubscribed', { admin: true });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.ok(list.data.subscribers.every((s) => s.status === 'unsubscribed'));
  assert.equal(list.data.delivery.storage, 'sqlite');
  assert.equal(list.data.delivery.configured, true);
  const csv = await call('GET', '/api/newsletter/admin/export', { admin: true });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /^attachment; filename="newsletter-subscribers-/);
  assert.deepEqual([...csv.raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for spreadsheet apps');
  assert.match(csv.data, /^\ufeffemail,status,locale,source,created_at,confirmed_at,unsubscribed_at\r\n/);
  assert.doesNotMatch(csv.data, /token|hash|re_test_key|nnnnnnnn/i);
});

test('HTTP: the shared bucket for unidentifiable clients is rate-limited too', async () => {
  let limited = 0;
  for (let i = 0; i < NEWSLETTER_LIMITS.sharedClientMax + 2; i++) {
    const r = await call('POST', '/api/newsletter/subscribe', { body: { email: `shared${i}@example.com` }, headers: { 'x-forwarded-for': '1.2.3.4' } });
    if (r.status === 429) limited++;
  }
  assert.ok(limited >= 1, 'forwarded-header clients share one bucket');
});

test('HTTP: missing configuration answers 503 and stores nothing', async () => {
  configure(false);
  const before = connection().prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').get().n;
  assert.deepEqual((await call('GET', '/api/newsletter/status')).data, { enabled: false });
  const r = await call('POST', '/api/newsletter/subscribe', { body: { email: 'unconfigured@example.com' } });
  assert.equal(r.status, 503);
  assert.equal(r.data.code, 'unavailable');
  assert.match(r.data.error, /not configured/);
  assert.equal(connection().prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').get().n, before);
  const admin = await call('GET', '/api/newsletter/admin/subscribers', { admin: true });
  assert.equal(admin.status, 200, 'the list stays readable for the owner');
  assert.ok(admin.data.delivery.missing.includes('NEWSLETTER_SECRET'));
});

/* ── HTTP: Netlify Function wiring (Blobs document) ──────────────────── */

function fakeBlobs() {
  const data = new Map();
  let n = 0;
  return {
    data,
    async getWithMetadata(key) { const e = data.get(key); return e ? { data: e.value, etag: e.etag, metadata: {} } : null; },
    async set(key, value, options) {
      const e = data.get(key);
      if (options.onlyIfNew && e) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== e?.etag) return { modified: false };
      data.set(key, { value, etag: `"${++n}"` });
      return { modified: true, etag: `"${n}"` };
    },
  };
}

test('Netlify wiring: same API over encrypted Blobs, isolated per deploy context', async () => {
  sentMail.length = 0;
  const blobs = fakeBlobs();
  const run = (method, path, body, context = 'production', headers = {}) => handleNewsletterRequest(
    new Request(new URL(path, 'https://archive.example'), { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }),
    { service: netlifyNewsletterService(blobs, context), client: { ip: '203.0.113.20' }, requireAdmin: () => {}, siteOrigin: 'https://archive.example' },
  );
  assert.equal((await run('POST', '/api/newsletter/subscribe', { email: 'blob@example.com' })).status, 202);
  assert.deepEqual([...blobs.data.keys()], ['subscribers-production.json']);
  assert.doesNotMatch(blobs.data.get('subscribers-production.json').value, /blob@example\.com/);
  const token = /#token=([A-Za-z0-9_-]{43})/.exec(sentMail[0].body.text)[1];
  assert.equal((await (await run('POST', '/api/newsletter/confirm', { token })).json()).status, 'confirmed');

  await run('POST', '/api/newsletter/subscribe', { email: 'preview@example.com' }, 'deploy-preview');
  assert.deepEqual([...blobs.data.keys()].sort(), ['subscribers-deploy-preview.json', 'subscribers-production.json']);

  delete process.env.NEWSLETTER_SECRET;
  const noSecret = await run('POST', '/api/newsletter/subscribe', { email: 'x@example.com' });
  assert.equal(noSecret.status, 503, 'a deploy without the production secret cannot open the store');
});

test('Netlify Function source: routes, platform rate limit, and no Node-server imports in its bundle', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../netlify/functions/newsletter.mts', import.meta.url), 'utf8');
  assert.match(source, /path: \['\/api\/newsletter', '\/api\/newsletter\/\*'\]/);
  assert.match(source, /rateLimit: \{ windowLimit: \d+, windowSize: \d+, aggregateBy: \['ip', 'domain'\] \}/);
  // Vite's bundler (rolldown) resolves the same graph Netlify's bundler will see.
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({ input: new URL('../netlify/functions/newsletter.mts', import.meta.url).pathname, platform: 'node', external: ['@netlify/blobs', /^node:/], logLevel: 'silent' });
  const inputs = (await bundle.generate({ format: 'esm' })).output[0].moduleIds;
  await bundle.close();
  assert.ok(inputs.some((p) => p.endsWith('src/server/newsletter/http.ts')));
  for (const forbidden of ['better-sqlite3', 'db/connection.ts', 'node_modules/astro/', 'src/ui/', 'src/pages/']) {
    assert.ok(!inputs.some((p) => p.includes(forbidden)), `${forbidden} must not be bundled into the function`);
  }
});

test('Netlify Function outside the Netlify runtime (no Blobs): a clear 503, never a crash', async () => {
  const fn = await import('../netlify/functions/newsletter.mts');
  const response = await fn.default(new Request('https://archive.example/api/newsletter/status'), { ip: '192.0.2.1' });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.code, 'unavailable'); assert.match(body.error, /Nothing was saved/);
});

/* ── provider adapters ───────────────────────────────────────────────── */

test('provider adapters send the documented payloads and keep errors free of addresses', async () => {
  const calls = [];
  const fake = (status) => async (url, init) => { calls.push({ url, headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) }); return new Response('{"message":"reader@example.com is invalid"}', { status }); };
  const from = { name: 'Red Room', email: 'letters@archive.example' };
  const message = { to: 'reader@example.com', subject: 'S', text: 'T', html: '<p>H</p>', headers: { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'Bad\nName': 'x', Injected: 'a\r\nBcc: z' }, idempotencyKey: 'confirm-abc' };

  await resendMailer('re_key', from, 'reply@archive.example', fake(200)).send(message);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].headers.authorization, 'Bearer re_key');
  assert.equal(calls[0].headers['idempotency-key'], 'confirm-abc');
  assert.deepEqual(calls[0].body, { from: 'Red Room <letters@archive.example>', to: ['reader@example.com'], subject: 'S', text: 'T', html: '<p>H</p>', reply_to: 'reply@archive.example', headers: { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });

  await brevoMailer('xkeysib', from, null, fake(201)).send(message);
  assert.equal(calls[1].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(calls[1].headers['api-key'], 'xkeysib');
  assert.deepEqual(calls[1].body, { sender: { email: 'letters@archive.example', name: 'Red Room' }, to: [{ email: 'reader@example.com' }], subject: 'S', textContent: 'T', htmlContent: '<p>H</p>', headers: { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });

  await assert.rejects(resendMailer('re_key', from, null, fake(422)).send(message), (e) => e.status === 422 && !/reader@example\.com/.test(e.message));
  await assert.rejects(brevoMailer('k', from, null, async () => { throw new TypeError('fetch failed'); }).send(message), (e) => e.status === null && /network error/.test(e.message));
});
