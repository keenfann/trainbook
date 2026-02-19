import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveAutomaticExportConfig,
  runAutomaticExportCycle,
  startAutomaticExports,
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

  it('falls back to defaults for invalid boolean and numeric config values', () => {
    const dbPath = '/tmp/trainbook.sqlite';
    const config = resolveAutomaticExportConfig({
      dbPath,
      env: {
        AUTO_EXPORT_ENABLED: 'maybe',
        AUTO_EXPORT_INTERVAL_DAYS: '0',
        AUTO_EXPORT_RETENTION_DAYS: '-10',
        AUTO_EXPORT_CHECK_INTERVAL_MINUTES: 'abc',
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.exportIntervalMs).toBe(7 * DAY_MS);
    expect(config.retentionMs).toBe(365 * DAY_MS);
    expect(config.checkIntervalMs).toBe(60 * 60 * 1000);
  });

  it('validates required arguments for export cycles', () => {
    const rootDir = createTempDir();
    const dbPath = path.join(rootDir, 'trainbook.sqlite');
    const exportDir = path.join(rootDir, 'exports');
    fs.writeFileSync(dbPath, 'snapshot');

    expect(() =>
      runAutomaticExportCycle({ dbPath, exportDir })
    ).toThrow('A database instance with exec(sql) is required.');
    expect(() =>
      runAutomaticExportCycle({ db: { exec: vi.fn() }, exportDir })
    ).toThrow('dbPath is required.');
    expect(() =>
      runAutomaticExportCycle({ db: { exec: vi.fn() }, dbPath })
    ).toThrow('exportDir is required.');

    expect(() =>
      runAutomaticExportCycle({
        db: { exec: vi.fn() },
        dbPath: path.join(rootDir, 'missing.sqlite'),
        exportDir,
      })
    ).toThrow('Database file does not exist');
  });

  it('can disable automatic exports and stop scheduled timers', () => {
    expect(
      startAutomaticExports({
        enabled: false,
      })
    ).toBeNull();

    const rootDir = createTempDir();
    const dbPath = path.join(rootDir, 'trainbook.sqlite');
    const exportDir = path.join(rootDir, 'exports');
    fs.writeFileSync(dbPath, 'snapshot');

    const logger = { info: vi.fn(), warn: vi.fn() };
    const nowMs = Date.parse('2026-02-01T00:00:00.000Z');
    const db = { exec: vi.fn() };
    const timer = { unref: vi.fn() };
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(timer);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => {});

    const controller = startAutomaticExports({
      enabled: true,
      db,
      dbPath,
      exportDir,
      checkIntervalMs: 2500,
      now: () => nowMs,
      logger,
    });

    expect(controller).not.toBeNull();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(timer.unref).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Automatic export created:'));

    controller.stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('logs warnings when an automatic export cycle fails', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const timer = { unref: vi.fn() };
    vi.spyOn(global, 'setInterval').mockReturnValue(timer);

    const controller = startAutomaticExports({
      enabled: true,
      db: null,
      dbPath: '/tmp/trainbook.sqlite',
      exportDir: '/tmp/exports',
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith('Automatic export cycle failed.', expect.any(Error));
    expect(controller.runOnce()).toBeNull();
  });
});
