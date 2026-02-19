import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../api.js';

export function useStatsAnalyticsData() {
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

  return {
    stats,
    weights,
    exerciseOptions,
    selectedExerciseId,
    setSelectedExerciseId,
    statsRoutineType,
    setStatsRoutineType,
    timeseriesBucket,
    setTimeseriesBucket,
    timeseriesWindow,
    setTimeseriesWindow,
    progressionWindow,
    setProgressionWindow,
    distributionMetric,
    setDistributionMetric,
    distributionWindow,
    setDistributionWindow,
    distributionDrilldownMuscle,
    setDistributionDrilldownMuscle,
    distributionDrilldown,
    setDistributionDrilldown,
    distributionDrilldownLoading,
    setDistributionDrilldownLoading,
    distributionDrilldownError,
    setDistributionDrilldownError,
    bodyweightWindow,
    setBodyweightWindow,
    bestLiftMetric,
    setBestLiftMetric,
    timeseries,
    progression,
    distribution,
    bodyweightTrend,
    error,
    loading,
    analyticsLoading,
    chartAnimationMode,
  };
}
