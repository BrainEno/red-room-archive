/**
 * Fetch the start of a public web page for a bookmark preview, without
 * letting article content turn the server into a proxy for its own network.
 *
 *   - http/https only, default ports only, no credentials in the URL;
 *   - every address a host resolves to must be public (no loopback, private,
 *     link-local, CGNAT, multicast, documentation or other reserved ranges).
 *     The check runs inside the socket's own DNS lookup, so a hostname cannot
 *     resolve to a public address for the check and a private one for the
 *     connection (DNS rebinding); literal IPs are checked before connecting;
 *   - redirects are followed by hand (at most 3), each hop re-checked;
 *   - HTML only, at most `maxBytes` read, one deadline for the whole fetch.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(address, prefix, 'ipv6');

/** IPv4 behind an IPv4-mapped / -compatible IPv6 address (`::ffff:a.b.c.d`, `::ffff:7f00:1`). */
function embeddedV4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (dotted) return dotted;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0]!;
  if (net.isIPv4(ip)) return !blocked.check(ip, 'ipv4');
  if (!net.isIPv6(ip)) return false;
  const v4 = embeddedV4(ip);
  if (v4) return net.isIPv4(v4) && !blocked.check(v4, 'ipv4');
  return !blocked.check(ip, 'ipv6');
}

export class BlockedUrlError extends Error {}

/** Throws BlockedUrlError for URLs that may never be fetched. */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('only http(s)');
  if (url.username || url.password) throw new BlockedUrlError('credentials in URL');
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) throw new BlockedUrlError('non-default port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new BlockedUrlError('local host name');
  if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError('non-public address');
  return url;
}

type Lookup = typeof dns.lookup;

/** dns.lookup that fails unless every resolved address is public. */
export const guardedLookup = (resolve: Lookup = dns.lookup, allow: (address: string) => boolean = isPublicAddress) =>
  ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = addresses as unknown as dns.LookupAddress[];
      if (!list.length || list.some((entry) => !allow(entry.address))) {
        return callback(Object.assign(new BlockedUrlError(`${hostname} resolves to a non-public address`), { code: 'EBLOCKED' }));
      }
      if (options.all) callback(null, list);
      else callback(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as net.LookupFunction;

export interface FetchedPage {
  url: string;
  contentType: string;
  body: Buffer;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Tests inject a resolver; production uses the system resolver. */
  lookup?: Lookup;
  /** Tests only: accept resolved addresses (e.g. a loopback test server). Defaults to isPublicAddress. */
  allowAddress?: (address: string) => boolean;
  /** Tests only: connect to this port instead of the URL's default one (loopback test server). */
  testPort?: number;
}

type Settings = Required<Omit<SafeFetchOptions, 'lookup' | 'allowAddress' | 'testPort'>> & Pick<SafeFetchOptions, 'lookup' | 'allowAddress' | 'testPort'>;

function requestOnce(url: URL, options: Settings, signal: AbortSignal) {
  return new Promise<{ status: number; location?: string; contentType: string; body: Buffer }>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'GET',
        ...(options.testPort ? { port: options.testPort } : {}),
        lookup: guardedLookup(options.lookup, options.allowAddress),
        signal,
        headers: {
          'User-Agent': options.userAgent,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Language': 'en,zh-CN;q=0.8,*;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers['content-type'] ?? '');
        if (status >= 300 && status < 400) {
          response.resume();
          return resolve({ status, location: response.headers.location, contentType, body: Buffer.alloc(0) });
        }
        if (status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          response.resume();
          return resolve({ status, contentType, body: Buffer.alloc(0) });
        }
        const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          encoding === 'gzip' || encoding === 'x-gzip' ? response.pipe(zlib.createGunzip())
          : encoding === 'deflate' ? response.pipe(zlib.createInflate())
          : encoding === 'br' ? response.pipe(zlib.createBrotliDecompress())
          : response;
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          response.destroy();
          resolve({ status, contentType, body: Buffer.concat(chunks).subarray(0, options.maxBytes) });
        };
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= options.maxBytes) finish(); // the <head> is long over by now
        });
        stream.on('end', finish);
        stream.on('error', (error) => (done ? undefined : (size ? finish() : reject(error))));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

/** GET a public HTML page (or null when it is not one). Throws BlockedUrlError for forbidden targets. */
export async function fetchPublicHtml(raw: string, options: SafeFetchOptions = {}): Promise<FetchedPage | null> {
  const settings: Settings = {
    timeoutMs: options.timeoutMs ?? 5000,
    maxBytes: options.maxBytes ?? 256 * 1024,
    maxRedirects: options.maxRedirects ?? 3,
    userAgent: options.userAgent ?? 'RedRoomArchive-LinkPreview/1.0',
    lookup: options.lookup,
    allowAddress: options.allowAddress,
    testPort: options.testPort,
  };
  const signal = AbortSignal.timeout(settings.timeoutMs);
  let url = assertFetchableUrl(raw);
  for (let hop = 0; hop <= settings.maxRedirects; hop++) {
    const response = await requestOnce(url, settings, signal);
    if (response.location && response.status >= 300 && response.status < 400) {
      url = assertFetchableUrl(new URL(response.location, url).toString());
      continue;
    }
    if (response.status !== 200 || !response.body.length) return null;
    return { url: url.toString(), contentType: response.contentType, body: response.body };
  }
  return null;
}
