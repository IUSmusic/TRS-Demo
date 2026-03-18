import { autoCorrelate } from './transcription.js';

function logGroup(title, payload, error) {
  console.groupCollapsed(title);
  if (payload) console.log(payload);
  if (error) console.error(error);
  console.groupEnd();
}

export async function startAudio(state, hooks) {
  try {
    hooks.stopAudio();
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    state.ctx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: state.settings.latencyMs < 100 ? 'interactive' : 'balanced',
    });
    await state.ctx.resume();
    const source = state.ctx.createMediaStreamSource(state.stream);
    state.analyser = state.ctx.createAnalyser();
    state.analyser.fftSize = 2048;
    state.gainNode = state.ctx.createGain();
    state.gainNode.gain.value = state.settings.inputGain;
    source.connect(state.gainNode);
    state.gainNode.connect(state.analyser);

    state.processorNode = state.ctx.createScriptProcessor(4096, 1, 1);
    state.processorMuteNode = state.ctx.createGain();
    state.processorMuteNode.gain.value = 0;
    source.connect(state.processorNode);
    state.processorNode.connect(state.processorMuteNode);
    state.processorMuteNode.connect(state.ctx.destination);
    state.processorNode.onaudioprocess = (event) => {
      try {
        const input = event.inputBuffer.getChannelData(0);
        hooks.onAudioChunk?.(Float32Array.from(input), event.inputBuffer.sampleRate || state.ctx.sampleRate);
      } catch (error) {
        console.warn('TRS:audio chunk callback failed', error);
      }
    };

    state.transport.isListening = true;
    hooks.tickAudio();
    hooks.render();
  } catch (error) {
    logGroup('TRS:startAudio failure', { settings: state.settings }, error);
    alert(`Mic start failed: ${error.message || error}`);
  }
}

export function stopAudio(state, hooks) {
  cancelAnimationFrame(state.raf);
  const now = performance.now();
  try {
    if (state.activeMidi !== null && state.noteStart) {
      hooks.pushEvent({
        id: crypto.randomUUID(),
        source: 'audio',
        pitchMidi: state.activeMidi,
        frequencyHz: 440 * Math.pow(2, (state.activeMidi - 69) / 12),
        startMs: state.noteStart,
        durationMs: Math.max(60, now - state.noteStart),
        confidence: 0.5,
        staff: state.activeMidi >= 60 ? 0 : 1,
      });
    }
    if (state.processorNode) {
      state.processorNode.onaudioprocess = null;
      state.processorNode.disconnect();
    }
    if (state.processorMuteNode) state.processorMuteNode.disconnect();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    if (state.ctx) state.ctx.close();
  } catch (error) {
    logGroup('TRS:stopAudio cleanup warning', null, error);
  }
  state.stream = null;
  state.ctx = null;
  state.analyser = null;
  state.gainNode = null;
  state.processorNode = null;
  state.processorMuteNode = null;
  state.transport.isListening = false;
  state.activeMidi = null;
  state.noteStart = 0;
  state.audioLevel = 0;
  hooks.onAudioStopped?.();
  hooks.render();
}

export function tickAudio(state, hooks) {
  try {
    if (!state.analyser || !state.ctx) return;
    const timeData = new Float32Array(state.analyser.fftSize);
    state.analyser.getFloatTimeDomainData(timeData);
    const rms = Math.sqrt(timeData.reduce((sum, x) => sum + x * x, 0) / timeData.length);
    state.audioLevel = rms;

    if (state.backendMode !== 'ml') {
      const freq = autoCorrelate(timeData, state.ctx.sampleRate);
      const conf = Math.min(1, rms * 10);
      const open = rms >= state.settings.noiseGate && freq > 0 && conf >= state.settings.confidenceThreshold;
      const now = performance.now();

      if (open) {
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        if (state.activeMidi === null) {
          state.activeMidi = midi;
          state.noteStart = now;
        } else if (Math.abs(state.activeMidi - midi) >= 1) {
          hooks.pushEvent({
            id: crypto.randomUUID(),
            source: 'audio',
            pitchMidi: state.activeMidi,
            frequencyHz: 440 * Math.pow(2, (state.activeMidi - 69) / 12),
            startMs: state.noteStart,
            durationMs: Math.max(60, now - state.noteStart),
            confidence: Math.min(0.95, Math.max(0.2, conf)),
            staff: state.activeMidi >= 60 ? 0 : 1,
          });
          state.activeMidi = midi;
          state.noteStart = now;
        }
        state.lastActive = now;
      }

      if (state.activeMidi !== null && now - state.lastActive > Math.max(80, state.settings.latencyMs)) {
        hooks.pushEvent({
          id: crypto.randomUUID(),
          source: 'audio',
          pitchMidi: state.activeMidi,
          frequencyHz: 440 * Math.pow(2, (state.activeMidi - 69) / 12),
          startMs: state.noteStart,
          durationMs: now - state.noteStart,
          confidence: Math.min(0.95, Math.max(0.2, conf)),
          staff: state.activeMidi >= 60 ? 0 : 1,
        });
        state.activeMidi = null;
      }
    }

    hooks.render();
  } catch (error) {
    logGroup('TRS:tickAudio failure', { listening: state.transport.isListening }, error);
  } finally {
    state.raf = requestAnimationFrame(() => hooks.tickAudio());
  }
}

export async function connectMidi(state, hooks) {
  if (!navigator.requestMIDIAccess) {
    alert('Web MIDI is not supported in this browser.');
    return;
  }
  try {
    state.midiAccess = await navigator.requestMIDIAccess();
    const names = [];
    for (const input of state.midiAccess.inputs.values()) {
      names.push(input.name || 'MIDI Input');
      input.onmidimessage = (message) => {
        try {
          const [status, note, velocity = 0] = message.data;
          const command = status & 0xf0;
          const now = performance.now();
          if (command === 0x90 && velocity > 0) {
            state.activeNotes.set(note, { startMs: now, velocity });
          } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            const active = state.activeNotes.get(note);
            if (!active) return;
            state.activeNotes.delete(note);
            hooks.pushEvent({
              id: crypto.randomUUID(),
              source: 'midi',
              pitchMidi: note,
              startMs: active.startMs,
              durationMs: Math.max(60, now - active.startMs),
              velocity: active.velocity,
              confidence: 1,
              staff: note >= 60 ? 0 : 1,
            });
          }
        } catch (error) {
          logGroup('TRS:midi message failure', { device: input.name }, error);
        }
      };
    }
    state.midiInputs = names;
    hooks.render();
  } catch (error) {
    logGroup('TRS:connectMidi failure', null, error);
    alert(`MIDI connect failed: ${error.message || error}`);
  }
}
