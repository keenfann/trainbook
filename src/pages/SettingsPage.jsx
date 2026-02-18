import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetch } from '../api.js';
import { getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import { APP_RELEASED_AT, APP_VERSION, LOCALE } from '../features/workout/workout-utils.js';

function SettingsPage({ user, onLogout }) {
  const { preference, setPreference, resolvedReducedMotion, motionMode } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [error, setError] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [validatingImport, setValidatingImport] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importInputKey, setImportInputKey] = useState(0);

  const handleLogout = async () => {
    setError(null);
    try {
      await onLogout();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePassword = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, nextPassword }),
      });
      setCurrentPassword('');
      setNextPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleExport = async () => {
    setError(null);
    try {
      const data = await apiFetch('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `trainbook-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setValidatingImport(true);
    setPendingImport(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const validation = await apiFetch('/api/import/validate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPendingImport({
        fileName: file.name,
        payload,
        validation,
      });
      if (!validation.valid) {
        setError(validation.errors?.join(' ') || 'Import validation failed.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setValidatingImport(false);
      event.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport?.validation?.valid) return;
    setError(null);
    setImporting(true);
    try {
      const data = await apiFetch('/api/import', {
        method: 'POST',
        body: JSON.stringify(pendingImport.payload),
      });
      setImportResult(data || null);
      setPendingImport(null);
      setImportInputKey((value) => value + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleCancelImport = () => {
    setPendingImport(null);
    setImportInputKey((value) => value + 1);
    setImportResult(null);
    setError(null);
  };


  const releaseTimestamp = useMemo(() => {
    if (!APP_RELEASED_AT) return 'Unknown';
    const parsed = new Date(APP_RELEASED_AT);
    if (Number.isNaN(parsed.getTime())) return APP_RELEASED_AT;
    return new Intl.DateTimeFormat(LOCALE, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(parsed);
  }, []);

  const importSummary = pendingImport?.validation?.summary || null;
  const reuseSummary = importSummary?.toReuse || {};

  return (
    <motion.div
      className="stack"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <h2 className="section-title">Settings</h2>
        <p className="muted">Account controls, backups, and environment.</p>
      </div>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            className="notice"
            variants={motionConfig.variants.fadeUp}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="card">
        <div className="section-title">Account</div>
        <div className="stack">
          <div className="inline">
            <span className="tag">User</span>
            <strong>{user?.username}</strong>
          </div>
          <form className="stack" onSubmit={handlePassword}>
            <label>Change password</label>
            <input
              className="input"
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="New password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              required
            />
            <button className="button" type="submit">
              Update password
            </button>
          </form>
          <button className="button ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Import & export</div>
        <div className="stack">
          <button className="button" onClick={handleExport}>
            Export JSON
          </button>
          <div>
            <label>Import JSON</label>
            <input
              key={importInputKey}
              type="file"
              accept="application/json"
              onChange={handleImport}
            />
            {validatingImport ? <div className="muted">Validating import…</div> : null}
            {importing ? <div className="muted">Importing…</div> : null}
            {pendingImport ? (
              <div className="stack" style={{ marginTop: '0.75rem' }}>
                <div className="tag">Validation summary for {pendingImport.fileName}</div>
                {importSummary ? (
                  <div className="muted">
                    Create: {importSummary.toCreate.exercises} exercises,{' '}
                    {importSummary.toCreate.routines} routines, {importSummary.toCreate.sessions}{' '}
                    workouts, {importSummary.toCreate.weights} weights
                    <br />
                    Reuse: {reuseSummary.exercises || 0} exercises,{' '}
                    {reuseSummary.routines || 0} routines, {reuseSummary.sessions || 0} workouts,{' '}
                    {reuseSummary.weights || 0} weights
                    <br />
                    Skip: {importSummary.skipped.exercises} exercises,{' '}
                    {importSummary.skipped.routines} routines, {importSummary.skipped.weights}{' '}
                    weights
                  </div>
                ) : null}
                {pendingImport.validation.warnings?.length ? (
                  <div className="muted">
                    Warnings: {pendingImport.validation.warnings.join(' ')}
                  </div>
                ) : null}
                {pendingImport.validation.valid ? (
                  <div className="inline">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={handleConfirmImport}
                      disabled={importing}
                    >
                      Confirm import
                    </button>
                    <button className="button ghost" type="button" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="button ghost" type="button" onClick={handleCancelImport}>
                    Clear validation
                  </button>
                )}
              </div>
            ) : null}
            {importResult ? (
              <div className="tag">
                Imported {importResult.importedCount?.exercises || 0} exercises,{' '}
                {importResult.importedCount?.routines || 0} routines,{' '}
                {importResult.importedCount?.sessions || 0} workouts,{' '}
                {importResult.importedCount?.weights || 0} bodyweight entries.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Motion</div>
        <div className="stack">
          <div>
            <label htmlFor="motion-preference-select">Animation preference</label>
            <select
              id="motion-preference-select"
              aria-label="Motion preference"
              value={preference}
              onChange={(event) => setPreference(event.target.value)}
            >
              <option value="system">System</option>
              <option value="reduced">Reduced</option>
              <option value="full">Full</option>
            </select>
          </div>
          <div className="muted">
            Active mode: {motionMode === 'reduced' ? 'Reduced motion' : 'Full motion'}.
            {preference === 'system' ? ' Following system preference.' : ''}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">About</div>
        <div className="inline">
          <span className="tag">Version</span>
          <strong>{APP_VERSION}</strong>
        </div>
        <div className="inline">
          <span className="tag">Released</span>
          <strong>{releaseTimestamp}</strong>
        </div>
        <p className="muted">Trainbook is designed for fast, satisfying workout logging.</p>
      </div>
    </motion.div>
  );
}

export default SettingsPage;
