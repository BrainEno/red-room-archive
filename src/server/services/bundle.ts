/**
 * Content bundle — everything that is edited in /admin rather than in Notion,
 * in one ZIP that a static build (Netlify / Cloudflare) can consume:
 *
 *   site-profile.json   public site text, facts, tag pairs (no credentials)
 *   more.json           the /more page, if it was saved in /admin
 *   uploads/<name>      files the More page references, plus the statue model
 *   README.txt          how to use it
 *
 * Unzip it into `site-content/` in the repository and rebuild; see
 * scripts/static-snapshot.mjs. Notion credentials and articles are never
 * included — articles always come from Notion.
 */
import { statSync } from 'node:fs';
import { makeProfile } from '../../../public/profile-format.js';
import { MODEL_NAME, resolveInDir } from '../storage/uploads.ts';
import { zipStream, type ZipEntry } from '../storage/zip.ts';
import { adminSettings } from './settings.ts';
import { moreDocument, uploadsUsedOnMore } from './more.ts';

export const MORE_FILE_FORMAT = 'red-room-more';

const README = `Red Room Archive — content bundle / 内容包

EN
This archive holds what you edit in /admin (not in Notion): the site profile,
the More page and the files it uses. To publish it with a static build:
  1. Unzip it into a folder named site-content/ at the repository root
     (site-content/site-profile.json, site-content/more.json, site-content/uploads/…).
  2. Commit the folder and rebuild (npm run build:static, or your Netlify /
     Cloudflare deploy). Articles still come from Notion.
No Notion token or admin token is included. Everything here becomes public.

中文
这个压缩包包含在 /admin 中编辑的内容（不在 Notion 里的部分）：站点资料、
“更多”页面及其使用的文件。用于静态部署：
  1. 解压到仓库根目录下的 site-content/ 文件夹
     （site-content/site-profile.json、site-content/more.json、site-content/uploads/…）。
  2. 提交该文件夹并重新构建（npm run build:static，或 Netlify / Cloudflare 部署）。
     文章仍然来自 Notion。
压缩包不含 Notion 令牌或后台令牌；其中的内容都会公开。
`;

/** An upload that exists on disk, as `[name, absolute path, mtime]`. */
function existingUpload(name: string): [string, string, Date] | null {
  const file = resolveInDir(name);
  if (!file) return null;
  try {
    const stat = statSync(file);
    return stat.isFile() ? [name, file, stat.mtime] : null;
  } catch {
    return null;
  }
}

export interface ContentBundle {
  filename: string;
  /** Upload names included under `uploads/`. */
  uploads: string[];
  stream: () => ReadableStream<Uint8Array>;
}

export function contentBundle(now = new Date()): ContentBundle {
  const profile = makeProfile(adminSettings().values);
  const more = moreDocument();
  const entries: ZipEntry[] = [
    { name: 'README.txt', data: README, mtime: now },
    { name: 'site-profile.json', data: JSON.stringify(profile, null, 2) + '\n', mtime: now },
  ];
  if (more.custom) {
    const file = { format: MORE_FILE_FORMAT, version: 1, document: more.document };
    entries.push({ name: 'more.json', data: JSON.stringify(file, null, 2) + '\n', mtime: more.updated ? new Date(more.updated) : now });
  }
  const names = [...new Set([...uploadsUsedOnMore(), MODEL_NAME])].sort();
  const uploads: string[] = [];
  for (const name of names) {
    const found = existingUpload(name);
    if (!found) continue;
    uploads.push(found[0]);
    entries.push({ name: `uploads/${found[0]}`, path: found[1], mtime: found[2] });
  }
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return { filename: `red-room-content-${day}.zip`, uploads, stream: () => zipStream(entries) };
}
