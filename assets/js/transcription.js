export function quantizeEvent(event, settings, bpm = 120) {
  const beatMs = 60000 / Math.max(1, bpm);
  const grid = beatMs / 4;
  const strength = settings.quantizationStrength ?? 0.7;
  const snap = (value) => {
    const target = Math.round(value / grid) * grid;
    return value + (target - value) * strength;
  };
  return {
    ...event,
    startMs: snap(event.startMs),
    durationMs: Math.max(grid / 2, snap(event.durationMs)),
  };
}

export function autoCorrelate(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.01) return -1;

  let bestOffset = -1;
  let bestCorrelation = 0;
  for (let offset = 8; offset < 1000; offset++) {
    let correlation = 0;
    for (let i = 0; i < buffer.length - offset; i++) correlation += Math.abs(buffer[i] - buffer[i + offset]);
    correlation = 1 - correlation / (buffer.length - offset);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }
  return bestCorrelation > 0.9 && bestOffset > 0 ? sampleRate / bestOffset : -1;
}

export function groupChordWindows(events, toleranceMs = 60) {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const groups = [];
  for (const event of sorted) {
    const last = groups[groups.length - 1];
    if (!last || Math.abs(last[0].startMs - event.startMs) > toleranceMs) groups.push([event]);
    else last.push(event);
  }
  return groups;
}

export function estimateChordLabel(windowEvents) {
  if (windowEvents.length < 2) return undefined;
  const pcs = [...new Set(windowEvents.map((e) => e.pitchMidi % 12))].sort((a, b) => a - b);
  const root = pcs[0];
  const hasMaj3 = pcs.includes((root + 4) % 12);
  const hasMin3 = pcs.includes((root + 3) % 12);
  const has5 = pcs.includes((root + 7) % 12);
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  if (hasMaj3 && has5) return `${names[root]}`;
  if (hasMin3 && has5) return `${names[root]}m`;
  return names[root];
}

export function estimateKey(events) {
  if (!events.length) return 'C major';
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const counts = new Array(12).fill(0);
  for (const e of events) counts[e.pitchMidi % 12] += 1;
  const best = counts.indexOf(Math.max(...counts));
  return `${names[best]} major`;
}

export function estimateMeter() {
  return '4/4';
}

export function midiToNoteName(midi) {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const name = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function detectTempo(events, fallbackBpm = 120) {
  if (!events || events.length < 6) return fallbackBpm;
  const starts = events
    .slice(-32)
    .map((e) => Number(e.startMs))
    .sort((a, b) => a - b);
  const diffs = [];
  for (let i = 1; i < starts.length; i++) {
    const diff = starts[i] - starts[i - 1];
    if (diff >= 120 && diff <= 2000) diffs.push(diff);
  }
  if (diffs.length < 4) return fallbackBpm;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  let bpm = 60000 / median;
  while (bpm < 72) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  bpm = Math.round(bpm);
  return Number.isFinite(bpm) ? bpm : fallbackBpm;
}

export function smartPruneEvents(events, cap = 500, windowMs = 60000, bucketLimit = 80) {
  if (events.length <= cap) return events;
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
  const newest = sorted[sorted.length - 1]?.startMs ?? 0;
  const buckets = new Map();
  const kept = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const event = sorted[i];
    const bucket = Math.floor((newest - event.startMs) / windowMs);
    const count = buckets.get(bucket) ?? 0;
    const localLimit = bucket === 0 ? bucketLimit : Math.max(24, Math.floor(bucketLimit / (bucket + 1)));
    if (count < localLimit || kept.length < Math.floor(cap * 0.7)) {
      kept.push(event);
      buckets.set(bucket, count + 1);
    }
    if (kept.length >= cap) break;
  }
  return kept.reverse();
}
