/**
 * Database backups.
 *
 * A backup is a full SQLite snapshot taken with `VACUUM INTO`: journal posts,
 * post history, site settings (including the Notion token — treat downloads as
 * secrets) and the Notion cache. Uploaded media are plain files in
 * `UPLOAD_DIR` and are not copied.
 *
 * Automatic backups need no timer: the request middleware calls
 * `scheduledBackupTick()`, which at most once a minute checks whether the
 * newest snapshot is older than `BACKUP_INTERVAL_HOURS`. The schedule is
 * derived from the files on disk, so it survives restarts and sleeping hosts.
 */
import type { BackupFile, BackupListResponse } from '../../shared/contracts.ts';
import { config } from '../config.ts';
import { snapshotTo } from '../db/connection.ts';
import {
  backupDir,
  listBackupFiles,
  nextBackupName,
  removeBackup,
  resolveBackup,
  writeAtomically,
  type BackupEntry,
} from '../storage/backups.ts';

export { removeBackup, resolveBackup };

const HOUR = 3_600_000;

export const presentBackup = (entry: BackupEntry): BackupFile => ({
  name: entry.name,
  size: entry.size,
  createdAt: new Date(entry.mtime).toISOString(),
  auto: entry.auto,
  url: `/api/backups/${encodeURIComponent(entry.name)}`,
});

/** Take a snapshot now. Automatic snapshots beyond `BACKUP_KEEP` are pruned. */
export function createBackup(options: { auto?: boolean; now?: Date } = {}): BackupFile {
  const auto = Boolean(options.auto);
  const entry = writeAtomically(nextBackupName(auto, options.now), snapshotTo);
  if (auto) pruneAutomatic();
  return presentBackup(entry);
}

function pruneAutomatic() {
  const keep = config.backupKeep();
  listBackupFiles()
    .filter((entry) => entry.auto)
    .slice(keep)
    .forEach((entry) => removeBackup(entry.name));
}

export function listBackups(now = Date.now()): BackupListResponse {
  const files = listBackupFiles();
  const intervalHours = config.backupIntervalHours();
  const last = files[0]?.mtime;
  // Never backed up → due now; otherwise one interval after the newest snapshot.
  const next = intervalHours > 0 ? (last ? Math.max(now, last + intervalHours * HOUR) : now) : undefined;
  return {
    backups: files.map(presentBackup),
    schedule: {
      intervalHours,
      keep: config.backupKeep(),
      lastBackupAt: last ? new Date(last).toISOString() : null,
      nextBackupAt: next !== undefined ? new Date(next).toISOString() : null,
      dir: backupDir(),
    },
  };
}

/** Take an automatic snapshot if one is due. Returns it, or null. */
export function runScheduledBackup(now = Date.now()): BackupFile | null {
  const intervalHours = config.backupIntervalHours();
  if (intervalHours <= 0) return null;
  const last = listBackupFiles()[0]?.mtime ?? 0;
  if (now - last < intervalHours * HOUR) return null;
  return createBackup({ auto: true, now: new Date(now) });
}

let lastCheck = 0;
const CHECK_EVERY_MS = 60_000;

/**
 * Cheap, throttled, never-throwing hook for the request middleware. The
 * snapshot runs after the current response has been handed off.
 */
export function scheduledBackupTick(now = Date.now()): void {
  if (now - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = now;
  setImmediate(() => {
    try {
      const made = runScheduledBackup();
      if (made) console.info(`[backup] wrote ${made.name} (${made.size} bytes)`);
    } catch (error) {
      console.error('[backup] automatic backup failed', error);
    }
  });
}

/** Tests only. */
export const resetBackupTick = () => {
  lastCheck = 0;
};
