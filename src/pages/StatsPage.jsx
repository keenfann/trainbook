import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../api.js';
import { getChartAnimationConfig, getMotionConfig } from '../motion.js';
import { useMotionPreferences } from '../motion-preferences.jsx';
import { formatElapsedSince } from '../date-labels.js';
import {
  formatMuscleLabel,
  formatDate,
  formatNumber,
  buildLinearTrendline,
  buildMovingAverage,
  formatDurationMinutes,
} from '../features/stats/stats-utils.js';

function StatsPage() {
  const { resolvedReducedMotion } = useMotionPreferences();
  const motionConfig = useMemo(
    () => getMotionConfig(resolvedReducedMotion),
    [resolvedReducedMotion]
  );
  const [stats, setStats] = useState(null);
  const [weights, setWeights] = useState([]);
  const [exerciseOptions, setExerciseOptions] = useState([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState('');
  const [statsRoutineType, setStatsRoutineType] = useState('all');
  const [timeseriesBucket, setTimeseriesBucket] = useState('week');
  const [timeseriesWindow, setTimeseriesWindow] = useState('180d');
  const [progressionWindow, setProgressionWindow] = useState('90d');
  const [distributionMetric, setDistributionMetric] = useState('frequency');
  const [distributionWindow, setDistributionWindow] = useState('30d');
  const [distributionDrilldownMuscle, setDistributionDrilldownMuscle] = useState('');
  const [distributionDrilldown, setDistributionDrilldown] = useState(null);
  const [distributionDrilldownLoading, setDistributionDrilldownLoading] = useState(false);
  const [distributionDrilldownError, setDistributionDrilldownError] = useState(null);
  const [bodyweightWindow, setBodyweightWindow] = useState('90d');
  const [bestLiftMetric, setBestLiftMetric] = useState('weight');
  const [timeseries, setTimeseries] = useState(null);
  const [progression, setProgression] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [bodyweightTrend, setBodyweightTrend] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [chartAnimationMode, setChartAnimationMode] = useState('initial');
  const hasLoadedAnalyticsRef = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsData, weightData, exerciseData] = await Promise.all([
          apiFetch(`/api/stats/overview?routineType=${statsRoutineType}`),
          apiFetch('/api/weights?limit=8'),
          apiFetch('/api/exercises'),
        ]);
        if (!active) return;
        setStats(statsData);
        setWeights(weightData.weights || []);
        const options = exerciseData.exercises || [];
        setExerciseOptions(options);
        if (!selectedExerciseId && options.length) {
          setSelectedExerciseId(String(options[0].id));
        }
      } catch (err) {
        if (!active) return;
        setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [statsRoutineType]);

  useEffect(() => {
    let active = true;
    const loadAnalytics = async () => {
      setAnalyticsLoading(true);
      setError(null);
      try {
        const progressionPath = selectedExerciseId
          ? `/api/stats/progression?exerciseId=${selectedExerciseId}&window=${progressionWindow}&routineType=${statsRoutineType}`
          : null;
        const requests = await Promise.all([
          apiFetch(`/api/stats/timeseries?bucket=${timeseriesBucket}&window=${timeseriesWindow}&routineType=${statsRoutineType}`),
          progressionPath ? apiFetch(progressionPath) : Promise.resolve(null),
          apiFetch(`/api/stats/distribution?metric=${distributionMetric}&window=${distributionWindow}&routineType=${statsRoutineType}`),
          apiFetch(`/api/stats/bodyweight-trend?window=${bodyweightWindow}`),
        ]);
        if (!active) return;
        setTimeseries(requests[0]);
        setProgression(requests[1]);
        setDistribution(requests[2]);
        setBodyweightTrend(requests[3]);
        setChartAnimationMode(hasLoadedAnalyticsRef.current ? 'update' : 'initial');
        hasLoadedAnalyticsRef.current = true;
      } catch (err) {
        if (!active) return;
        setError(err.message);
      } finally {
        if (active) {
          setAnalyticsLoading(false);
        }
      }
    };
    loadAnalytics();
    return () => {
      active = false;
    };
  }, [
    selectedExerciseId,
    progressionWindow,
    statsRoutineType,
    distributionMetric,
    distributionWindow,
    bodyweightWindow,
    timeseriesBucket,
    timeseriesWindow,
  ]);

  useEffect(() => {
    let active = true;
    if (!distributionDrilldownMuscle) {
      setDistributionDrilldown(null);
      setDistributionDrilldownError(null);
      setDistributionDrilldownLoading(false);
      return () => {
        active = false;
      };
    }

    const loadDistributionDrilldown = async () => {
      setDistributionDrilldownLoading(true);
      setDistributionDrilldownError(null);
      try {
        const data = await apiFetch(
          `/api/stats/distribution/drilldown?muscle=${encodeURIComponent(distributionDrilldownMuscle)}&metric=${distributionMetric}&window=${distributionWindow}&routineType=${statsRoutineType}`
        );
        if (!active) return;
        setDistributionDrilldown(data);
      } catch (err) {
        if (!active) return;
        setDistributionDrilldownError(err.message);
      } finally {
        if (!active) return;
        setDistributionDrilldownLoading(false);
      }
    };

    loadDistributionDrilldown();
    return () => {
      active = false;
    };
  }, [distributionDrilldownMuscle, distributionMetric, distributionWindow, statsRoutineType]);

  const summary = stats?.summary || {};
  const elapsedSinceLastSession = useMemo(
    () => formatElapsedSince(summary.lastSessionAt),
    [summary.lastSessionAt]
  );

  const timeseriesData = useMemo(() => {
    const basePoints = (timeseries?.points || []).map((point) => ({
      bucketKey: String(point.bucketKey || ''),
      label: String(point.label || ''),
      startAt: point.startAt,
      sets: Number(point.sets || 0),
      volume: Number(point.volume || 0),
      sessions: Number(point.sessions || 0),
      uniqueExercises: Number(point.uniqueExercises || 0),
      avgSetWeight: Number(point.avgSetWeight || 0),
    }));
    const sessionsTrend = buildLinearTrendline(basePoints, 'sessions');
    return basePoints.map((point, index) => ({
      ...point,
      sessionsTrend: sessionsTrend[index],
    }));
  }, [timeseries]);

  const progressionData = useMemo(() => {
    const basePoints = (progression?.points || []).map((point, index) => ({
      id: `${point.sessionId || 'session'}-${index}`,
      label: formatDate(point.startedAt),
      startedAt: point.startedAt,
      topWeight: Number(point.topWeight || 0),
      topReps: Number(point.topReps || 0),
      topVolume: Number(point.topVolume || 0),
    }));
    const topWeightTrend = buildLinearTrendline(basePoints, 'topWeight');
    const topWeightMoving = buildMovingAverage(basePoints, 'topWeight', 7);
    return basePoints.map((point, index) => ({
      ...point,
      topWeightTrend: topWeightTrend[index],
      topWeightMoving: topWeightMoving[index],
    }));
  }, [progression]);

  const distributionData = useMemo(
    () =>
      (distribution?.rows || []).map((row) => ({
        bucket: String(row.bucket || 'other'),
        label: formatMuscleLabel(row.bucket || 'other'),
        value: Number(row.value || 0),
        share: Number(row.share || 0),
      })),
    [distribution]
  );

  const distributionDrilldownData = useMemo(
    () =>
      (distributionDrilldown?.rows || []).map((row) => ({
        exerciseId: Number(row.exerciseId || 0),
        bucket: String(row.exerciseId || ''),
        label: String(row.name || 'Exercise'),
        setCount: Number(row.setCount || 0),
        volume: Number(row.volume || 0),
        value: Number(row.value || 0),
        share: Number(row.share || 0),
      })),
    [distributionDrilldown]
  );

  const activeDistributionData = distributionDrilldownMuscle
    ? distributionDrilldownData
    : distributionData;

  const handleDistributionBarClick = (entry) => {
    if (distributionDrilldownMuscle) return;
    const bucket = String(entry?.bucket || entry?.payload?.bucket || '').trim();
    if (!bucket) return;
    setDistributionDrilldownMuscle(bucket);
  };

  const resetDistributionDrilldown = () => {
    setDistributionDrilldownMuscle('');
    setDistributionDrilldown(null);
    setDistributionDrilldownError(null);
    setDistributionDrilldownLoading(false);
  };

  const bodyweightData = useMemo(() => {
    const sourcePoints = (bodyweightTrend?.points || []).length
      ? bodyweightTrend.points
      : weights;
    const sorted = [...sourcePoints].sort((a, b) => {
      const left = new Date(a.measuredAt || a.measured_at).getTime();
      const right = new Date(b.measuredAt || b.measured_at).getTime();
      return left - right;
    });
    const basePoints = sorted.map((entry, index) => ({
      id: `${entry.id || 'weight'}-${index}`,
      measuredAt: entry.measuredAt || entry.measured_at,
      label: formatDate(entry.measuredAt || entry.measured_at),
      weight: Number(entry.weight || 0),
    }));
    const trend = buildLinearTrendline(basePoints, 'weight');
    const movingAverage = buildMovingAverage(basePoints, 'weight', 7);
    return basePoints.map((point, index) => ({
      ...point,
      trend: trend[index],
      movingAverage: movingAverage[index],
    }));
  }, [bodyweightTrend, weights]);

  const topExercisesData = useMemo(() => {
    const rows = (stats?.topExercises || []).map((exercise) => ({
      ...exercise,
      name: String(exercise.name || ''),
      maxWeight: Number(exercise.maxWeight || 0),
      maxReps: Number(exercise.maxReps || 0),
    }));
    const sortKey = bestLiftMetric === 'reps' ? 'maxReps' : 'maxWeight';
    return rows.sort((left, right) => {
      const diff = right[sortKey] - left[sortKey];
      if (diff !== 0) return diff;
      return left.name.localeCompare(right.name);
    });
  }, [stats?.topExercises, bestLiftMetric]);

  const chartAnimation = useMemo(
    () => getChartAnimationConfig(resolvedReducedMotion, chartAnimationMode),
    [resolvedReducedMotion, chartAnimationMode]
  );

  if (loading) {
    return <div className="card">Loading stats…</div>;
  }

  if (error) {
    return <div className="notice">{error}</div>;
  }

  return (
    <motion.div
      className="stack stats-page"
      variants={motionConfig.variants.listStagger}
      initial="hidden"
      animate="visible"
    >
      <div>
        <div className="split">
          <div>
            <h2 className="section-title">Stats</h2>
            <p className="muted">Progression insights with weekly and monthly trend lines.</p>
          </div>
          <div className="stats-controls">
            <select
              aria-label="Stats routine type"
              value={statsRoutineType}
              onChange={(event) => setStatsRoutineType(event.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="rehab">Rehab</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </div>

      <div className="stats-kpi-grid">
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Workouts</div>
          <div className="section-title">{formatNumber(summary.sessionsWeek)} / {formatNumber(summary.sessionsMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Sets</div>
          <div className="section-title">{formatNumber(summary.setsWeek)} / {formatNumber(summary.setsMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Time since last workout</div>
          <div className="section-title">{elapsedSinceLastSession}</div>
          <div className="muted stats-kpi-meta">
            {summary.lastSessionAt ? `Last workout: ${formatDate(summary.lastSessionAt)}` : 'No workouts yet'}
          </div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Exercises</div>
          <div className="section-title">{formatNumber(summary.uniqueExercisesWeek)} / {formatNumber(summary.uniqueExercisesMonth)}</div>
          <div className="muted stats-kpi-meta">7d / 30d</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Bodyweight delta</div>
          <div className="section-title">
            {bodyweightTrend?.summary?.delta == null ? '—' : `${formatNumber(bodyweightTrend.summary.delta)} kg`}
          </div>
          <div className="muted stats-kpi-meta">{formatNumber(summary.totalSessions)} total workouts</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Avg Workouts per week</div>
          <div className="section-title">{formatNumber(summary.avgSessionsPerWeek)}</div>
          <div className="muted stats-kpi-meta">Rolling 90d average</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Time spent per week</div>
          <div className="section-title">{formatDurationMinutes(summary.timeSpentWeekMinutes)}</div>
          <div className="muted stats-kpi-meta">Last 7 days</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Warmup time</div>
          <div className="section-title">{formatDurationMinutes(summary.avgWarmupTimeMinutes)}</div>
          <div className="muted stats-kpi-meta">Completed warmups (30d)</div>
        </div>
        <div className="card stats-kpi-card">
          <div className="muted stats-kpi-label">Avg workout time</div>
          <div className="section-title">{formatDurationMinutes(summary.avgSessionTimeMinutes)}</div>
          <div className="muted stats-kpi-meta">Completed workouts (30d)</div>
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-header">
          <div>
            <div className="section-title">Workload over time</div>
            <p className="muted stats-card-subtitle">Set and workout counts per selected time bucket.</p>
          </div>
          <div className="stats-controls">
            <select
              aria-label="Timeseries bucket"
              value={timeseriesBucket}
              onChange={(event) => setTimeseriesBucket(event.target.value)}
            >
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
            <select
              aria-label="Timeseries window"
              value={timeseriesWindow}
              onChange={(event) => setTimeseriesWindow(event.target.value)}
            >
              <option value="90d">90 days</option>
              <option value="180d">180 days</option>
              <option value="365d">365 days</option>
            </select>
          </div>
        </div>
        {analyticsLoading ? (
          <div className="muted">Loading analytics…</div>
        ) : timeseriesData.length ? (
          <div className="stats-chart">
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={timeseriesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                <XAxis dataKey="label" stroke="var(--muted)" />
                <YAxis yAxisId="sets" stroke="var(--muted)" />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Legend />
                <Bar yAxisId="sets" dataKey="sets" name="Sets" fill="var(--accent)" radius={[6, 6, 0, 0]} {...chartAnimation} />
                <Line yAxisId="sets" type="monotone" dataKey="sessions" name="Workouts" stroke="var(--teal)" strokeWidth={2.2} dot={false} {...chartAnimation} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="muted">No workload data for this window.</div>
        )}
      </div>

      <div className="card-grid two stats-grid">
        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Exercise activity</div>
              <p className="muted stats-card-subtitle">Workouts and unique exercises per bucket.</p>
            </div>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : timeseriesData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={timeseriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis stroke="var(--muted)" />
                  <Tooltip formatter={(value) => formatNumber(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="sessions" name="Workouts" stroke="var(--teal)" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line type="monotone" dataKey="uniqueExercises" name="Unique exercises" stroke="#9dc07b" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line type="monotone" dataKey="sessionsTrend" name="Workout trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">No activity data for this window.</div>
          )}
        </div>

        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Exercise progression</div>
              <p className="muted stats-card-subtitle">Top weight and reps with trend and rolling average.</p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Progression exercise"
                value={selectedExerciseId}
                onChange={(event) => setSelectedExerciseId(event.target.value)}
              >
                {exerciseOptions.length ? (
                  exerciseOptions.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))
                ) : (
                  <option value="">No exercises</option>
                )}
              </select>
              <select
                aria-label="Progression window"
                value={progressionWindow}
                onChange={(event) => setProgressionWindow(event.target.value)}
              >
                <option value="90d">90 days</option>
                <option value="180d">180 days</option>
                <option value="365d">365 days</option>
              </select>
            </div>
          </div>
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : progressionData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={progressionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis yAxisId="weight" stroke="var(--muted)" />
                  <YAxis yAxisId="reps" orientation="right" stroke="var(--muted)" />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Top reps') return [formatNumber(value), name];
                      return [`${formatNumber(value)} kg`, name];
                    }}
                  />
                  <Legend />
                  <Line yAxisId="weight" dataKey="topWeight" name="Top weight" stroke="var(--accent)" strokeWidth={2.4} dot={false} {...chartAnimation} />
                  <Line yAxisId="weight" dataKey="topWeightMoving" name="7-point average" stroke="#7dc7e4" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line yAxisId="weight" dataKey="topWeightTrend" name="Weight trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line yAxisId="reps" dataKey="topReps" name="Top reps" stroke="#9dc07b" strokeWidth={1.8} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">No progression data for this window.</div>
          )}
        </div>
      </div>

      <div className="card-grid two stats-grid">
        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Muscle-group set distribution</div>
              <p className="muted stats-card-subtitle">
                {distributionDrilldownMuscle
                  ? `Exercise-level breakdown for ${formatMuscleLabel(distributionDrilldownMuscle)}.`
                  : 'Frequency or volume split by primary muscle.'}
              </p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Distribution metric"
                value={distributionMetric}
                onChange={(event) => setDistributionMetric(event.target.value)}
              >
                <option value="frequency">Frequency</option>
                <option value="volume">Volume</option>
              </select>
              <select
                aria-label="Distribution window"
                value={distributionWindow}
                onChange={(event) => setDistributionWindow(event.target.value)}
              >
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
              </select>
            </div>
            {distributionDrilldownMuscle ? (
              <button
                className="button ghost stats-distribution-back-button"
                type="button"
                onClick={resetDistributionDrilldown}
              >
                Back to muscle groups
              </button>
            ) : null}
          </div>
          {distributionDrilldownError ? (
            <div className="notice">{distributionDrilldownError}</div>
          ) : analyticsLoading || (distributionDrilldownMuscle && distributionDrilldownLoading) ? (
            <div className="muted">Loading analytics…</div>
          ) : activeDistributionData.length ? (
            <>
              <div className="stats-chart">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={activeDistributionData} layout="vertical" margin={{ left: 16, right: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                    <XAxis type="number" stroke="var(--muted)" />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={distributionDrilldownMuscle ? 168 : 120}
                      stroke="var(--muted)"
                    />
                    <Tooltip
                      formatter={(value, name, item) => {
                        const point = item?.payload;
                        if (distributionDrilldownMuscle) {
                          if (distributionMetric === 'volume') {
                            return [
                              `${formatNumber(value)} kg · ${formatNumber(point?.setCount)} sets`,
                              `${point?.label || name}`,
                            ];
                          }
                          return [
                            `${formatNumber(value)} sets · ${formatNumber(point?.volume)} kg`,
                            `${point?.label || name}`,
                          ];
                        }
                        if (distributionMetric === 'volume') {
                          return [`${formatNumber(value)} kg`, `${point?.label || name}`];
                        }
                        return [`${formatNumber(value)} sets`, `${point?.label || name}`];
                      }}
                    />
                    <Bar
                      dataKey="value"
                      name="Distribution"
                      fill="var(--accent)"
                      radius={[0, 6, 6, 0]}
                      cursor={distributionDrilldownMuscle ? 'default' : 'pointer'}
                      onClick={distributionDrilldownMuscle ? undefined : handleDistributionBarClick}
                      {...chartAnimation}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {distributionDrilldownMuscle ? (
                <div className="stats-distribution-breakdown-wrap">
                  <table className="stats-distribution-breakdown-table">
                    <thead>
                      <tr>
                        <th scope="col">Exercise</th>
                        <th scope="col">Sets</th>
                        <th scope="col">Volume</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distributionDrilldownData.map((row) => (
                        <tr key={row.exerciseId || row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{formatNumber(row.setCount)}</td>
                          <td>{formatNumber(row.volume)} kg</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted">
              {distributionDrilldownMuscle
                ? 'No exercise data for this muscle in the selected window.'
                : 'No distribution data for this window.'}
            </div>
          )}
        </div>

        <div className="card stats-card">
          <div className="stats-card-header">
            <div>
              <div className="section-title">Bodyweight trend</div>
              <p className="muted stats-card-subtitle">Logged weight with 7-point average and linear trend.</p>
            </div>
            <div className="stats-controls">
              <select
                aria-label="Bodyweight window"
                value={bodyweightWindow}
                onChange={(event) => setBodyweightWindow(event.target.value)}
              >
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="180d">180 days</option>
              </select>
            </div>
          </div>
          {bodyweightTrend?.summary?.latestWeight != null ? (
            <div className="tag stats-chip">
              Start {formatNumber(bodyweightTrend.summary.startWeight)} kg · Latest {formatNumber(bodyweightTrend.summary.latestWeight)} kg · Delta {formatNumber(bodyweightTrend.summary.delta)} kg
            </div>
          ) : null}
          {analyticsLoading ? (
            <div className="muted">Loading analytics…</div>
          ) : bodyweightData.length ? (
            <div className="stats-chart">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={bodyweightData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245, 243, 238, 0.12)" />
                  <XAxis dataKey="label" stroke="var(--muted)" />
                  <YAxis stroke="var(--muted)" />
                  <Tooltip formatter={(value) => [`${formatNumber(value)} kg`, 'Bodyweight']} />
                  <Legend />
                  <Line dataKey="weight" name="Bodyweight" stroke="var(--accent)" strokeWidth={2.4} dot={false} {...chartAnimation} />
                  <Line dataKey="movingAverage" name="7-point average" stroke="var(--teal)" strokeWidth={2} dot={false} {...chartAnimation} />
                  <Line dataKey="trend" name="Trend" stroke="#f4c56a" strokeDasharray="6 6" strokeWidth={2} dot={false} {...chartAnimation} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="muted">Log weight in the workout view.</div>
          )}
        </div>
      </div>

      <div className="card stats-card">
        <div className="stats-card-header">
          <div>
            <div className="section-title">Recent best lifts</div>
            <p className="muted stats-card-subtitle">Current top recorded set metric per exercise.</p>
          </div>
          <div className="stats-best-lifts-toggle" role="group" aria-label="Best lifts metric">
            <button
              className={`stats-best-lifts-toggle-button ${bestLiftMetric === 'weight' ? 'active' : ''}`}
              type="button"
              aria-pressed={bestLiftMetric === 'weight'}
              onClick={() => setBestLiftMetric('weight')}
            >
              Weight
            </button>
            <button
              className={`stats-best-lifts-toggle-button ${bestLiftMetric === 'reps' ? 'active' : ''}`}
              type="button"
              aria-pressed={bestLiftMetric === 'reps'}
              onClick={() => setBestLiftMetric('reps')}
            >
              Reps
            </button>
          </div>
        </div>
        {topExercisesData.length ? (
          <div className="stats-best-lifts-table-wrap">
            <table className="stats-best-lifts-table">
              <thead>
                <tr>
                  <th scope="col">Exercise</th>
                  <th scope="col">{bestLiftMetric === 'weight' ? 'Weight' : 'Reps'}</th>
                </tr>
              </thead>
              <tbody>
                {topExercisesData.map((exercise) => (
                  <tr key={exercise.exerciseId}>
                    <th scope="row">{exercise.name}</th>
                    <td>
                      {bestLiftMetric === 'weight'
                        ? `${formatNumber(exercise.maxWeight)} kg`
                        : `${formatNumber(exercise.maxReps)} reps`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">No top lift data yet.</div>
        )}
      </div>
    </motion.div>
  );
}

export default StatsPage;
