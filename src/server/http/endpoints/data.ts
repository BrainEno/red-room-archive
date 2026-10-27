/**
 * Backups, export and import (admin only).
 *
 *   GET    /api/backups              snapshots + schedule
 *   POST   /api/backups              take a snapshot now → 201 BackupFile
 *   GET    /api/backups/:name        download the SQLite file
 *   DELETE /api/backups/:name        → 204
 *   GET    /api/export               ZIP of Markdown posts + site.json + entries
 *   POST   /api/import               ZIP or Markdown (raw body or multipart `file`)
 *                                    ?onConflict=skip|overwrite|rename &dryRun=1 &settings=1
 */
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { badRequest, payloadTooLarge } from '../../../core/errors.ts';
import type { BackupFile, BackupListResponse, ImportConflict, ImportReport } from '../../../shared/contracts.ts';
import { config } from '../../config.ts';
import { requireAdmin } from '../../services/auth.ts';
import { createBackup, listBackups, removeBackup, resolveBackup } from '../../services/backups.ts';
import { CONFLICT_MODES, exportArchive, importArchive, type ImportFile } from '../../services/portability.ts';
import { NO_STORE, attachment, created, json, param, readBytes, route, truthy } from '../respond.ts';

/* ── Backups ────────────────────────────────────────────────────────── */

export const backups = route((context) => {
  requireAdmin(context.request);
  return json<BackupListResponse>(listBackups(), { headers: NO_STORE });
});

export const backupNow = route((context) => {
  requireAdmin(context.request);
  const backup = createBackup();
  return created<BackupFile>(backup, backup.url);
});

export const downloadBackup = route((context) => {
  requireAdmin(context.request);
  const entry = resolveBackup(param(context, 'name'));
  const body = Readable.toWeb(createReadStream(entry.file)) as ReadableStream;
  return new Response(body, {
    headers: attachment(entry.name, 'application/vnd.sqlite3', { 'Content-Length': String(entry.size) }),
  });
});

export const deleteBackup = route((context) => {
  requireAdmin(context.request);
  removeBackup(param(context, 'name'));
  return new Response(null, { status: 204, headers: NO_STORE });
});

/* ── Export / import ────────────────────────────────────────────────── */

export const exportZip = route((context) => {
  requireAdmin(context.request);
  const { filename, data } = exportArchive();
  return new Response(new Uint8Array(data), {
    headers: attachment(filename, 'application/zip', { 'Content-Length': String(data.length) }),
  });
});

async function importFiles(request: Request, url: URL): Promise<ImportFile[]> {
  const max = config.maxImportBytes();
  const type = request.headers.get('content-type') ?? '';
  if (type.startsWith('multipart/form-data')) {
    if (Number(request.headers.get('content-length') ?? 0) > max) throw payloadTooLarge();
    const form = await request.formData();
    const files = form.getAll('file').filter((value): value is File => typeof value !== 'string');
    if (!files.length) throw badRequest('multipart body needs one or more "file" fields');
    if (files.reduce((sum, file) => sum + file.size, 0) > max) throw payloadTooLarge();
    return Promise.all(files.map(async (file) => ({ name: file.name, data: Buffer.from(await file.arrayBuffer()) })));
  }
  const data = await readBytes(request, max);
  if (!data.length) throw badRequest('empty request body');
  const fallback = /zip/.test(type) ? 'import.zip' : 'import.md';
  return [{ name: url.searchParams.get('name')?.trim() || fallback, data }];
}

export const importPosts = route(async (context) => {
  requireAdmin(context.request);
  const search = context.url.searchParams;
  const onConflict = (search.get('onConflict') ?? 'skip') as ImportConflict;
  if (!CONFLICT_MODES.includes(onConflict)) throw badRequest('onConflict must be skip, overwrite or rename', { onConflict });
  const files = await importFiles(context.request, context.url);
  const report = importArchive(files, {
    onConflict,
    dryRun: truthy(search.get('dryRun')),
    settings: truthy(search.get('settings')),
  });
  return json<ImportReport>(report, { headers: NO_STORE });
});
