const AUDIO_SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const AUDIO_WINDOW_SAMPLES = AUDIO_SAMPLE_RATE * 2 - FFT_HOP; // 43844
const ANNOT_N_FRAMES = (AUDIO_SAMPLE_RATE / FFT_HOP) * 2; // 172
const MIDI_OFFSET = 21;
const FRAME_MS = (FFT_HOP / AUDIO_SAMPLE_RATE) * 1000;
const MODEL_URL = './assets/models/basic-pitch-spotify-icassp-2022.onnx';
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeEventId(prefix, startMs, pitchMidi) {
  return `${prefix}:${Math.round(startMs)}:${pitchMidi}`;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

function convertProfileToRange(profile) {
  switch (profile) {
    case 'voice':
      return { minMidi: 45, maxMidi: 84 };
    case 'violin':
      return { minMidi: 55, maxMidi: 103 };
    case 'guitar':
      return { minMidi: 40, maxMidi: 88 };
    case 'keyboard':
      return { minMidi: 21, maxMidi: 108 };
    case 'polyphonic-hint':
    default:
      return { minMidi: 21, maxMidi: 108 };
  }
}

function ensureOrtLoaded() {
  if (window.ort) return Promise.resolve(window.ort);
  if (window.__trsOrtPromise) return window.__trsOrtPromise;
  window.__trsOrtPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-trs-ort="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.ort));
      existing.addEventListener('error', () => reject(new Error('ONNX Runtime script failed to load.')));
      return;
    }
    const script = document.createElement('script');
    script.src = `${ORT_CDN}ort.min.js`;
    script.async = true;
    script.dataset.trsOrt = '1';
    script.onload = () => resolve(window.ort);
    script.onerror = () => reject(new Error('ONNX Runtime script failed to load.'));
    document.head.appendChild(script);
  });
  return window.__trsOrtPromise;
}

function downsampleLinear(samples, inRate, outRate) {
  if (inRate === outRate) return Float32Array.from(samples);
  const outLength = Math.max(1, Math.round(samples.length * outRate / inRate));
  const out = new Float32Array(outLength);
  const ratio = inRate / outRate;
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = samples[index] ?? 0;
    const b = samples[Math.min(index + 1, samples.length - 1)] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function concatFloat32(chunks, totalLength) {
  const out = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function pushChunkBuffer(state, samples, inputRate) {
  const down = downsampleLinear(samples, inputRate, AUDIO_SAMPLE_RATE);
  state.targetBuffers.push(down);
  state.targetBufferedSamples += down.length;
  state.totalTargetSamples += down.length;

  const maxKeep = AUDIO_WINDOW_SAMPLES * 4;
  while (state.targetBufferedSamples > maxKeep && state.targetBuffers.length) {
    const first = state.targetBuffers[0];
    const remove = Math.min(first.length, state.targetBufferedSamples - maxKeep);
    if (remove === first.length) {
      state.targetBuffers.shift();
    } else {
      state.targetBuffers[0] = first.slice(remove);
    }
    state.targetBufferedSamples -= remove;
  }
}

function currentWindow(state) {
  if (state.targetBufferedSamples < AUDIO_WINDOW_SAMPLES) return null;
  const joined = concatFloat32(state.targetBuffers, state.targetBufferedSamples);
  return joined.slice(joined.length - AUDIO_WINDOW_SAMPLES);
}

function reshapeOutput(tensor, frames, bins) {
  const data = tensor.data || tensor;
  const out = [];
  for (let f = 0; f < frames; f++) {
    const row = new Float32Array(bins);
    row.set(data.subarray(f * bins, (f + 1) * bins));
    out.push(row);
  }
  return out;
}

function decodeWindow(outputs, options = {}) {
  const onsetThresh = options.onsetThreshold ?? 0.5;
  const frameThresh = options.frameThreshold ?? 0.3;
  const minFrames = options.minFrames ?? 11;
  const energyTol = options.energyTolerance ?? 11;
  const profileRange = convertProfileToRange(options.profile ?? 'voice');
  const minIndex = clamp(profileRange.minMidi - MIDI_OFFSET, 0, 87);
  const maxIndex = clamp(profileRange.maxMidi - MIDI_OFFSET, 0, 87);

  const frames = reshapeOutput(outputs.note, ANNOT_N_FRAMES, 88);
  const onsets = reshapeOutput(outputs.onset, ANNOT_N_FRAMES, 88);
  const remaining = frames.map((row) => Float32Array.from(row));
  const notes = [];

  for (let pitch = minIndex; pitch <= maxIndex; pitch++) {
    const peaks = [];
    for (let t = 1; t < ANNOT_N_FRAMES - 1; t++) {
      const value = onsets[t][pitch];
      if (value >= onsetThresh && value >= onsets[t - 1][pitch] && value >= onsets[t + 1][pitch]) {
        peaks.push({ t, value });
      }
    }
    peaks.sort((a, b) => b.t - a.t);

    for (const peak of peaks) {
      let i = peak.t + 1;
      let k = 0;
      while (i < ANNOT_N_FRAMES - 1 && k < energyTol) {
        if (remaining[i][pitch] < frameThresh) k += 1;
        else k = 0;
        i += 1;
      }
      i -= k;
      if (i - peak.t <= minFrames) continue;

      for (let x = peak.t; x < i; x++) {
        remaining[x][pitch] = 0;
        if (pitch > 0) remaining[x][pitch - 1] = 0;
        if (pitch < 87) remaining[x][pitch + 1] = 0;
      }
      const amps = [];
      for (let x = peak.t; x < i; x++) amps.push(frames[x][pitch]);
      notes.push({
        startFrame: peak.t,
        endFrame: i,
        pitchMidi: pitch + MIDI_OFFSET,
        amplitude: quantile(amps, 0.8) || peak.value,
      });
    }
  }

  if (options.allowResidual !== false) {
    for (let pitch = minIndex; pitch <= maxIndex; pitch++) {
      let t = 0;
      while (t < ANNOT_N_FRAMES) {
        while (t < ANNOT_N_FRAMES && remaining[t][pitch] < frameThresh) t += 1;
        const start = t;
        while (t < ANNOT_N_FRAMES && remaining[t][pitch] >= frameThresh) t += 1;
        if (t - start > minFrames) {
          const amps = [];
          for (let x = start; x < t; x++) amps.push(remaining[x][pitch]);
          notes.push({
            startFrame: start,
            endFrame: t,
            pitchMidi: pitch + MIDI_OFFSET,
            amplitude: quantile(amps, 0.75),
          });
        }
      }
    }
  }

  notes.sort((a, b) => a.startFrame - b.startFrame || a.pitchMidi - b.pitchMidi);
  return notes;
}

export async function createBasicPitchBackend({ onStatus } = {}) {
  onStatus?.('Loading ONNX Runtime…');
  const ort = await ensureOrtLoaded();
  ort.env.wasm.wasmPaths = ORT_CDN;
  ort.env.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 1);
  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  onStatus?.('Model ready');

  const state = {
    session,
    targetBuffers: [],
    targetBufferedSamples: 0,
    totalTargetSamples: 0,
    lastInferenceAtMs: 0,
    lastCommittedCutoffMs: -Infinity,
    emittedIds: new Set(),
  };

  return {
    name: 'Spotify Basic Pitch ONNX',
    pushAudioChunk(samples, inputRate) {
      pushChunkBuffer(state, samples, inputRate);
    },
    async process(nowMs, options = {}) {
      if (state.targetBufferedSamples < AUDIO_WINDOW_SAMPLES) return [];
      if (nowMs - state.lastInferenceAtMs < (options.inferenceIntervalMs ?? 650)) return [];
      state.lastInferenceAtMs = nowMs;
      const windowData = currentWindow(state);
      if (!windowData) return [];
      const input = new ort.Tensor('float32', windowData, [1, AUDIO_WINDOW_SAMPLES, 1]);
      const outputs = await state.session.run({ 'serving_default_input_2:0': input });
      const decoded = decodeWindow({
        note: outputs['StatefulPartitionedCall:1'],
        onset: outputs['StatefulPartitionedCall:2'],
        contour: outputs['StatefulPartitionedCall:0'],
      }, {
        onsetThreshold: clamp(options.onsetThreshold ?? 0.5, 0.2, 0.85),
        frameThreshold: clamp(options.frameThreshold ?? 0.3, 0.15, 0.65),
        minFrames: options.minFrames ?? 10,
        profile: options.profile,
      });

      const windowEndMs = (state.totalTargetSamples / AUDIO_SAMPLE_RATE) * 1000;
      const windowStartMs = windowEndMs - (AUDIO_WINDOW_SAMPLES / AUDIO_SAMPLE_RATE) * 1000;
      const stableCutoffMs = windowEndMs - (options.stableTailMs ?? 450);
      const events = [];
      for (const note of decoded) {
        const startMs = windowStartMs + note.startFrame * FRAME_MS;
        const endMs = windowStartMs + note.endFrame * FRAME_MS;
        if (endMs <= state.lastCommittedCutoffMs || endMs > stableCutoffMs) continue;
        const id = makeEventId('ml', startMs, note.pitchMidi);
        if (state.emittedIds.has(id)) continue;
        state.emittedIds.add(id);
        events.push({
          id,
          source: 'ml',
          pitchMidi: note.pitchMidi,
          frequencyHz: 440 * Math.pow(2, (note.pitchMidi - 69) / 12),
          startMs,
          durationMs: Math.max(80, endMs - startMs),
          confidence: clamp(note.amplitude, 0.2, 0.99),
          staff: note.pitchMidi >= 60 ? 0 : 1,
        });
      }
      state.lastCommittedCutoffMs = Math.max(state.lastCommittedCutoffMs, stableCutoffMs);
      return events;
    },
    async flush(options = {}) {
      const events = await this.process(Number.MAX_SAFE_INTEGER, { ...options, stableTailMs: 0, inferenceIntervalMs: 0 });
      return events;
    },
    reset() {
      state.targetBuffers = [];
      state.targetBufferedSamples = 0;
      state.totalTargetSamples = 0;
      state.lastInferenceAtMs = 0;
      state.lastCommittedCutoffMs = -Infinity;
      state.emittedIds.clear();
    },
  };
}
