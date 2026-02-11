import fs from 'fs';
import path from 'path';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPORT_INTERVAL_DAYS = 7;
const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_CHECK_INTERVAL_MINUTES = 60;
const DEFAULT_EXPORT_INTERVAL_MS = DEFAULT_EXPORT_INTERVAL_DAYS * DAY_MS;
const DEFAULT_RETENTION_MS = DEFAULT_RETENTION_DAYS * DAY_MS;
const DEFAULT_CHECK_INTERVAL_MS = DEFAULT_CHECK_INTERVAL_MINUTES * 60 * 1000;

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveNumber(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getBackupFilePattern(dbPath) {
  const extension = path.extname(dbPath) || '.sqlite';
  const baseName = path.basename(dbPath, extension);
  return {
    extension,
    prefix: `${baseName}-backup-`,
  };
}

function listBackupFiles(exportDir, filePattern) {
  if (!fs.existsSync(exportDir)) {
    return [];
  }
  return fs
    .readdirSync(exportDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(filePattern.prefix) &&
        entry.name.endsWith(filePattern.extension)
    )
    .map((entry) => {
      const fullPath = path.join(exportDir, entry.name);
      const stats = fs.statSync(fullPath);
      return {
        path: fullPath,
        mtimeMs: stats.mtimeMs,
      };
    });
}

function resolveNowMs(now) {
  if (now instanceof Date) {
    return now.getTime();
  }
  const parsed = Number(now);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return Date.now();
}

function formatTimestampForFilename(timestampMs) {
  return new Date(timestampMs).toISOString().replace(/[:.]/g, '-');
}

function latestBackupMtimeMs(files) {
  if (!files.length) {
    return null;
  }
  return files.reduce(
    (currentMax, file) => (file.mtimeMs > currentMax ? file.mtimeMs : currentMax),
    files[0].mtimeMs
  );
}

function pruneExpiredBackups(exportDir, filePattern, nowMs, retentionMs) {
  const expirationCutoff = nowMs - retentionMs;
  const removedPaths = [];
  const backupFiles = listBackupFiles(exportDir, filePattern);
  backupFiles.forEach((file) => {
    if (file.mtimeMs >= expirationCutoff) {
      return;
    }
    fs.rmSync(file.path, { force: true });
    removedPaths.push(file.path);
  });
  return removedPaths;
}

function createBackupFile({ db, dbPath, exportDir, filePattern, nowMs }) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file does not exist: ${dbPath}`);
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const timestamp = formatTimestampForFilename(nowMs);
  const exportPath = path.join(
    exportDir,
    `${filePattern.prefix}${timestamp}${filePattern.extension}`
  );
  fs.copyFileSync(dbPath, exportPath);
  const exportTime = new Date(nowMs);
  fs.utimesSync(exportPath, exportTime, exportTime);
  return exportPath;
}

function resolveExportDir(dbPath, configuredExportDir) {
  if (configuredExportDir) {
    return path.resolve(configuredExportDir);
  }
  return path.join(path.dirname(dbPath), 'exports');
}

function resolveAutomaticExportConfig({ dbPath, env = process.env } = {}) {
  const exportDir = resolveExportDir(dbPath, env.AUTO_EXPORT_DIR);
  const exportIntervalDays = parsePositiveNumber(
    env.AUTO_EXPORT_INTERVAL_DAYS,
    DEFAULT_EXPORT_INTERVAL_DAYS
  );
  const retentionDays = parsePositiveNumber(
    env.AUTO_EXPORT_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS
  );
  const checkIntervalMinutes = parsePositiveNumber(
    env.AUTO_EXPORT_CHECK_INTERVAL_MINUTES,
    DEFAULT_CHECK_INTERVAL_MINUTES
  );

  return {
    enabled: parseBoolean(env.AUTO_EXPORT_ENABLED, true),
    exportDir,
    exportIntervalMs: exportIntervalDays * DAY_MS,
    retentionMs: retentionDays * DAY_MS,
    checkIntervalMs: checkIntervalMinutes * 60 * 1000,
  };
}

function runAutomaticExportCycle({
  db,
  dbPath,
  exportDir,
  exportIntervalMs = DEFAULT_EXPORT_INTERVAL_MS,
  retentionMs = DEFAULT_RETENTION_MS,
  now = Date.now(),
} = {}) {
  if (!db || typeof db.exec !== 'function') {
    throw new Error('A database instance with exec(sql) is required.');
  }
  if (!dbPath) {
    throw new Error('dbPath is required.');
  }
  if (!exportDir) {
    throw new Error('exportDir is required.');
  }

  const nowMs = resolveNowMs(now);
  const filePattern = getBackupFilePattern(dbPath);
  fs.mkdirSync(exportDir, { recursive: true });

  const existingFiles = listBackupFiles(exportDir, filePattern);
  const mostRecentExportMs = latestBackupMtimeMs(existingFiles);
  const shouldCreateExport =
    mostRecentExportMs === null || nowMs - mostRecentExportMs >= exportIntervalMs;

  const exportPath = shouldCreateExport
    ? createBackupFile({ db, dbPath, exportDir, filePattern, nowMs })
    : null;

  const removedPaths = pruneExpiredBackups(exportDir, filePattern, nowMs, retentionMs);

  return {
    created: Boolean(exportPath),
    exportPath,
    removedPaths,
  };
}

function startAutomaticExports({
  db,
  dbPath,
  enabled = true,
  exportDir,
  exportIntervalMs = DEFAULT_EXPORT_INTERVAL_MS,
  retentionMs = DEFAULT_RETENTION_MS,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!enabled) {
    return null;
  }

  const runOnce = () => {
    try {
      const result = runAutomaticExportCycle({
        db,
        dbPath,
        exportDir,
        exportIntervalMs,
        retentionMs,
        now: now(),
      });
      if (result.created && result.exportPath) {
        logger.info(`Automatic export created: ${result.exportPath}`);
      }
      if (result.removedPaths.length > 0) {
        logger.info(
          `Automatic export cleanup removed ${result.removedPaths.length} expired file(s).`
        );
      }
      return result;
    } catch (error) {
      logger.warn('Automatic export cycle failed.', error);
      return null;
    }
  };

  runOnce();
  const timer = setInterval(runOnce, checkIntervalMs);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
    runOnce,
  };
}

export {
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_EXPORT_INTERVAL_MS,
  DEFAULT_RETENTION_MS,
  resolveAutomaticExportConfig,
  runAutomaticExportCycle,
  startAutomaticExports,
};
