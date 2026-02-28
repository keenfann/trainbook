import {
  formatDate,
  formatDurationMinutes,
  formatNumber,
} from '../stats-utils.js';

function StatsKpiGrid({
  summary,
  elapsedSinceLastSession,
  bodyweightTrend,
  avgTimeSpentWeekMinutes,
  avgTimeSpentMonthMinutes,
  avgWarmupTimeWeekMinutes,
  avgWarmupTimeMonthMinutes,
  avgWorkoutTimeWeekMinutes,
  avgWorkoutTimeMonthMinutes,
  medianWorkoutTimeWeekMinutes,
  medianWorkoutTimeMonthMinutes,
  avgWorkoutsPerWeekThirty,
}) {
  return (
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
        <div className="section-title">
          {formatNumber(summary.avgSessionsPerWeekThirty ?? avgWorkoutsPerWeekThirty)} / {formatNumber(summary.avgSessionsPerWeekNinety ?? summary.avgSessionsPerWeek)}
        </div>
        <div className="muted stats-kpi-meta">30d / 90d</div>
      </div>
      <div className="card stats-kpi-card">
        <div className="muted stats-kpi-label">Avg time spent per week</div>
        <div className="section-title">
          {formatDurationMinutes(avgTimeSpentWeekMinutes)} / {formatDurationMinutes(avgTimeSpentMonthMinutes)}
        </div>
        <div className="muted stats-kpi-meta">7d / 30d</div>
      </div>
      <div className="card stats-kpi-card">
        <div className="muted stats-kpi-label">Avg warmup time</div>
        <div className="section-title">
          {formatDurationMinutes(avgWarmupTimeWeekMinutes)} / {formatDurationMinutes(avgWarmupTimeMonthMinutes)}
        </div>
        <div className="muted stats-kpi-meta">7d / 30d</div>
      </div>
      <div className="card stats-kpi-card">
        <div className="muted stats-kpi-label">Median workout time</div>
        <div className="section-title">
          {formatDurationMinutes(medianWorkoutTimeWeekMinutes)} / {formatDurationMinutes(medianWorkoutTimeMonthMinutes)}
        </div>
        <div className="muted stats-kpi-meta">Avg workout time (capped): {formatDurationMinutes(avgWorkoutTimeWeekMinutes)} / {formatDurationMinutes(avgWorkoutTimeMonthMinutes)}</div>
      </div>
    </div>
  );
}

export default StatsKpiGrid;
