export function buildLinearTrendline(points, key) {
  if (!Array.isArray(points) || points.length < 2) {
    return Array.isArray(points) ? points.map(() => null) : [];
  }

  const samples = points
    .map((point, index) => {
      const value = Number(point?.[key]);
      return Number.isFinite(value) ? { x: index, y: value } : null;
    })
    .filter(Boolean);

  if (samples.length < 2) {
    return points.map(() => null);
  }

  const n = samples.length;
  const sumX = samples.reduce((sum, sample) => sum + sample.x, 0);
  const sumY = samples.reduce((sum, sample) => sum + sample.y, 0);
  const sumXX = samples.reduce((sum, sample) => sum + sample.x * sample.x, 0);
  const sumXY = samples.reduce((sum, sample) => sum + sample.x * sample.y, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (!denominator) {
    return points.map(() => null);
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return points.map((_, index) => Number((slope * index + intercept).toFixed(2)));
}

export function buildMovingAverage(points, key, windowSize = 7) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const normalizedWindow = Math.max(2, Number(windowSize || 7));
  return points.map((_, index) => {
    const start = index - normalizedWindow + 1;
    if (start < 0) return null;
    const window = points.slice(start, index + 1);
    const values = window
      .map((point) => Number(point?.[key]))
      .filter((value) => Number.isFinite(value));
    if (values.length < normalizedWindow) return null;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Number(average.toFixed(2));
  });
}
