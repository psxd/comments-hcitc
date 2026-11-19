// Both charts and threshold results consume this same synchronized series.
export function sampleEpisode(startMs, endMs, stepMs, sampleAt) {
  const samples = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) samples.push({ ms, ...sampleAt(ms) });
  if (samples.at(-1)?.ms !== endMs) samples.push({ ms: endMs, ...sampleAt(endMs) });
  return samples;
}

function belowInterval(a, b, threshold) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < threshold && b < threshold) return [0, 1];
  if (a >= threshold && b >= threshold) return null;
  const crossing = (threshold - a) / (b - a);
  return a < threshold ? [0, crossing] : [crossing, 1];
}

export function analyzeEpisode(samples, distanceKm, speedMps, stepMs) {
  const valid = samples.filter(s => Number.isFinite(s.distanceKm) && Number.isFinite(s.speedMps));
  const minimumDistance = valid.reduce((best, s) => !best || s.distanceKm < best.value ? { ms: s.ms, value: s.distanceKm } : best, null);
  const minimumSpeed = valid.reduce((best, s) => !best || s.speedMps < best.value ? { ms: s.ms, value: s.speedMps } : best, null);
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], dt = b.ms - a.ms;
    // Never bridge a missing sample, a long sampling gap, or a nearest-TLE switch.
    if (dt <= 0 || dt > stepMs * 1.01 || !Number.isFinite(a.distanceKm) || !Number.isFinite(b.distanceKm) ||
        !Number.isFinite(a.speedMps) || !Number.isFinite(b.speedMps) ||
        a.tleA !== b.tleA || a.tleB !== b.tleB) continue;
    const distance = belowInterval(a.distanceKm, b.distanceKm, distanceKm);
    const speed = belowInterval(a.speedMps, b.speedMps, speedMps);
    if (!distance || !speed) continue;
    const low = Math.max(distance[0], speed[0]), high = Math.min(distance[1], speed[1]);
    if (high <= low) continue;
    const start = a.ms + low * dt, end = a.ms + high * dt;
    const last = intervals.at(-1);
    if (last && Math.abs(last.end - start) < 1) last.end = end;
    else intervals.push({ start, end });
  }
  const totalMs = intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const longest = intervals.reduce((best, interval) => !best || interval.end - interval.start > best.end - best.start ? interval : best, null);
  return { intervals, totalMs, longest, minimumDistance, minimumSpeed, validSamples: valid.length };
}

// Classify only sampled, TLE-consistent intervals already accepted by
// analyzeEpisode. A single threshold must be true exclusively, not merely
// part of an interval where both are true.
export function exclusiveQualificationIntervals(distanceIntervals, speedIntervals) {
  const boundaries = [...new Set([...distanceIntervals, ...speedIntervals].flatMap(item => [item.start, item.end]))].sort((a, b) => a - b);
  const single = [], both = [];
  const contains = (intervals, ms) => intervals.some(item => item.start < ms && ms < item.end);
  for (let index = 1; index < boundaries.length; index++) {
    const start = boundaries[index - 1], end = boundaries[index], midpoint = (start + end) / 2;
    const count = Number(contains(distanceIntervals, midpoint)) + Number(contains(speedIntervals, midpoint));
    const target = count === 1 ? single : count === 2 ? both : null;
    if (!target || end <= start) continue;
    const last = target.at(-1);
    if (last && Math.abs(last.end - start) < 1) last.end = end;
    else target.push({ start, end });
  }
  return { single, both };
}
