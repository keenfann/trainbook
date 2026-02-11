import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveAutomaticExportConfig,
  runAutomaticExportCycle,
} from '../server/auto-export.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const createdTempDirs = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainbook-auto-export-'));
  createdTempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  createdTempDirs.splice(0).forEach((tempDir) => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('automatic export scheduling', () => {
  it('creates a backup immediately and then waits until the weekly interval elapses', () => {
    const rootDir = createTempDir();
    const dbPath = path.join(rootDir, 'trainbook.sqlite');
    const exportDir = path.join(rootDir, 'exports');
    const db = { exec: vi.fn() };
    fs.writeFileSync(dbPath, 'snapshot-v1');

    const firstRunAt = Date.parse('2026-02-01T00:00:00.000Z');
    const firstRun = runAutomaticExportCycle({
      db,
      dbPath,
      exportDir,
      now: firstRunAt,
    });
    expect(firstRun.created).toBe(true);
    expect(firstRun.exportPath).toBeTypeOf('string');
    expect(fs.existsSync(firstRun.exportPath)).toBe(true);
    expect(fs.readFileSync(firstRun.exportPath, 'utf8')).toBe('snapshot-v1');
    expect(db.exec).toHaveBeenCalledWith('PRAGMA wal_checkpoint(TRUNCATE);');

    const secondRun = runAutomaticExportCycle({
      db,
      dbPath,
      exportDir,
      now: firstRunAt + DAY_MS,
    });
    expect(secondRun.created).toBe(false);
    expect(db.exec).toHaveBeenCalledTimes(1);

    fs.writeFileSync(dbPath, 'snapshot-v2');
    const thirdRun = runAutomaticExportCycle({
      db,
      dbPath,
      exportDir,
      now: firstRunAt + 8 * DAY_MS,
    });
    expect(thirdRun.created).toBe(true);
    expect(db.exec).toHaveBeenCalledTimes(2);
    expect(thirdRun.exportPath).toBeTypeOf('string');
    expect(fs.readFileSync(thirdRun.exportPath, 'utf8')).toBe('snapshot-v2');
  });

  it('deletes backup files older than the configured retention window', () => {
    const rootDir = createTempDir();
    const dbPath = path.join(rootDir, 'trainbook.sqlite');
    const exportDir = path.join(rootDir, 'exports');
    const db = { exec: vi.fn() };
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(dbPath, 'snapshot-v1');

    const oldBackupPath = path.join(exportDir, 'trainbook-backup-old.sqlite');
    const recentBackupPath = path.join(exportDir, 'trainbook-backup-recent.sqlite');
    fs.writeFileSync(oldBackupPath, 'old');
    fs.writeFileSync(recentBackupPath, 'recent');

    const nowMs = Date.parse('2026-02-11T00:00:00.000Z');
    fs.utimesSync(
      oldBackupPath,
      new Date(nowMs - 400 * DAY_MS),
      new Date(nowMs - 400 * DAY_MS)
    );
    fs.utimesSync(
      recentBackupPath,
      new Date(nowMs - 20 * DAY_MS),
      new Date(nowMs - 20 * DAY_MS)
    );

    const result = runAutomaticExportCycle({
      db,
      dbPath,
      exportDir,
      now: nowMs,
      exportIntervalMs: 100 * DAY_MS,
      retentionMs: 365 * DAY_MS,
    });

    expect(result.created).toBe(false);
    expect(result.removedPaths).toContain(oldBackupPath);
    expect(fs.existsSync(oldBackupPath)).toBe(false);
    expect(fs.existsSync(recentBackupPath)).toBe(true);
    expect(db.exec).not.toHaveBeenCalled();
  });

  it('resolves export configuration from environment values', () => {
    const dbPath = '/tmp/trainbook.sqlite';
    const defaults = resolveAutomaticExportConfig({ dbPath, env: {} });
    expect(defaults.enabled).toBe(true);
    expect(defaults.exportDir).toBe('/tmp/exports');
    expect(defaults.exportIntervalMs).toBe(7 * DAY_MS);
    expect(defaults.retentionMs).toBe(365 * DAY_MS);
    expect(defaults.checkIntervalMs).toBe(60 * 60 * 1000);

    const custom = resolveAutomaticExportConfig({
      dbPath,
      env: {
        AUTO_EXPORT_ENABLED: 'false',
        AUTO_EXPORT_DIR: './db/backups',
        AUTO_EXPORT_INTERVAL_DAYS: '14',
        AUTO_EXPORT_RETENTION_DAYS: '90',
        AUTO_EXPORT_CHECK_INTERVAL_MINUTES: '5',
      },
    });
    expect(custom.enabled).toBe(false);
    expect(custom.exportDir).toBe(path.resolve('./db/backups'));
    expect(custom.exportIntervalMs).toBe(14 * DAY_MS);
    expect(custom.retentionMs).toBe(90 * DAY_MS);
    expect(custom.checkIntervalMs).toBe(5 * 60 * 1000);
  });
});
