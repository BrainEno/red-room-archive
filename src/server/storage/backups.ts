/**
 * Database snapshot files in `BACKUP_DIR` (default `<data dir>/backups`).
 *
 * Names are generated here and look like `auto-20261027-134501.db` or
 * `manual-20261027-134501.db`; anything else in the directory is ignored and
 * nothing outside it can be read or deleted.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { badRequest, notFound } from '../../core/errors.ts';
import { config } from '../config.ts';

export interface BackupEntry {
  name: string;
  file: string;
  size: number;
  mtime: number;
  auto: boolean;
}

const NAME = /^(auto|manual)-\d{8}-\d{6}(?:-\d+)?\.db$/;

export const backupDir = (): string => {
  const dir = config.backupDir();
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const isBackupName = (name: string) => NAME.test(String(name ?? ''));

const stamp = (date: Date) => date.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');

/** A fresh, unused file name for a snapshot taken at `date`. */
export function nextBackupName(auto: boolean, date = new Date()): string {
  const base = `${auto ? 'auto' : 'manual'}-${stamp(date)}`;
  const dir = backupDir();
  let name = `${base}.db`;
  for (let i = 2; existsSync(path.join(dir, name)); i++) name = `${base}-${i}.db`;
  return name;
}

/** Newest first. */
export function listBackupFiles(): BackupEntry[] {
  const dir = backupDir();
  return readdirSync(dir)
    .filter(isBackupName)
    .flatMap((name) => {
      try {
        const stat = statSync(path.join(dir, name));
        return stat.isFile()
          ? [{ name, file: path.join(dir, name), size: stat.size, mtime: stat.mtimeMs, auto: name.startsWith('auto-') }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}

export function resolveBackup(name: string): BackupEntry {
  if (!isBackupName(name)) throw badRequest('invalid backup name', { name });
  const found = listBackupFiles().find((entry) => entry.name === name);
  if (!found) throw notFound('backup not found', { name });
  return found;
}

export function removeBackup(name: string): void {
  unlinkSync(resolveBackup(name).file);
}

/** Write via a temporary name so a half-written file never looks like a backup. */
export function writeAtomically(name: string, write: (file: string) => void): BackupEntry {
  const dir = backupDir();
  const final = path.join(dir, name);
  const temp = path.join(dir, `.${name}.tmp`);
  try {
    if (existsSync(temp)) unlinkSync(temp);
    write(temp);
    renameSync(temp, final);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  const stat = statSync(final);
  return { name, file: final, size: stat.size, mtime: stat.mtimeMs, auto: name.startsWith('auto-') };
}
