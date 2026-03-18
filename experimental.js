import { startAudio, stopAudio, tickAudio, connectMidi } from './assets/js/audio.js';
import { renderApp } from './assets/js/render.js';
import { exportMusicXml, exportMidi, downloadFile } from './assets/js/exporters.js';
import { quantizeEvent, estimateKey, estimateMeter, detectTempo, smartPruneEvents, midiToNoteName } from './assets/js/transcription.js';
import { createBasicPitchBackend } from './assets/js/basicpitch.js';

(() => {
  const SESSION_KEY = 'trsSession';
  const UNDO_KEY_LIMIT = 25;

  const state = {
    settings: {
      noiseGate: 0.03,
      latencyMs: 120,
      inputGain: 1,
      confidenceThreshold: 0.25,
      quantizationStrength: 0.7,
      profile: 'voice',
    },
    transport: { isListening: false, bpm: 120, meter: '4/4', key: 'C major' },
    events: [],
    midiInputs: [],
    audioLevel: 0,
    stream: null,
    ctx: null,
    analyser: null,
    gainNode: null,
    processorNode: null,
    processorMuteNode: null,
    raf: 0,
    lastActive: 0,
    noteStart: 0,
    activeMidi: null,
    midiAccess: null,
    activeNotes: new Map(),
    backendLabel: 'Spotify Basic Pitch ONNX · loading',
    backendMode: 'ml',
    backendStatus: 'Model pending',
    basicPitch: null,
    mlBusy: false,
    undoStack: [],
  };

  function replaceWithClone(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.replaceWith(clone);
    return clone;
  }

  const els = {
    startMicBtn: replaceWithClone('startMicBtn'),
    stopMicBtn: replaceWithClone('stopMicBtn'),
    connectMidiBtn: replaceWithClone('connectMidiBtn'),
    clearBtn: replaceWithClone('clearBtn'),
    exportJsonBtn: replaceWithClone('exportJsonBtn'),
    exportTxtBtn: replaceWithClone('exportTxtBtn'),
    exportMusicXmlBtn: replaceWithClone('exportMusicXmlBtn'),
    noiseGate: replaceWithClone('noiseGate'),
    latencyMs: replaceWithClone('latencyMs'),
    inputGain: replaceWithClone('inputGain'),
    confidenceThreshold: replaceWithClone('confidenceThreshold'),
    quantizationStrength: replaceWithClone('quantizationStrength'),
    profile: replaceWithClone('profile'),
    themeSelect: document.getElementById('themeSelect'),
    noiseGateValue: document.getElementById('noiseGateValue'),
    latencyValue: document.getElementById('latencyValue'),
    inputGainValue: document.getElementById('inputGainValue'),
    confidenceValue: document.getElementById('confidenceValue'),
    quantValue: document.getElementById('quantValue'),
    keyBadge: document.getElementById('keyBadge'),
    meterBadge: document.getElementById('meterBadge'),
    bpmBadge: document.getElementById('bpmBadge'),
    backendBadge: document.getElementById('backendBadge'),
    backendLabel: document.getElementById('backendLabel'),
    micLevel: document.getElementById('micLevel'),
    listeningValue: document.getElementById('listeningValue'),
    midiInputsValue: document.getElementById('midiInputsValue'),
    lastChordValue: document.getElementById('lastChordValue'),
    eventsCount: document.getElementById('eventsCount'),
    recentNotesBody: document.getElementById('recentNotesBody'),
    timeline: document.getElementById('timeline'),
    scoreView: document.getElementById('scoreView'),
  };

  const hooks = {
    startAudio: () => startAudio(state, hooks),
    stopAudio: () => stopAudio(state, hooks),
    tickAudio: () => tickAudio(state, hooks),
    connectMidi: () => connectMidi(state, hooks),
    onAudioChunk,
    onAudioStopped,
    pushEvent,
    render,
  };

  hydrateFromSession();
  hydrateFromQuery();
  bindControls();
  render();
  initBackend();

  async function initBackend() {
    state.backendLabel = 'Spotify Basic Pitch ONNX · loading';
    state.backendStatus = 'Fetching model';
    render();
    try {
      state.basicPitch = await createBasicPitchBackend({
        onStatus(message) {
          state.backendStatus = message;
          render();
        },
      });
      state.backendMode = 'ml';
      state.backendLabel = 'Spotify Basic Pitch ONNX';
      state.backendStatus = 'Ready';
    } catch (error) {
      console.error('TRS:Basic Pitch backend failed', error);
      state.basicPitch = null;
      state.backendMode = 'heuristic';
      state.backendLabel = 'Heuristic fallback';
      state.backendStatus = error?.message || 'ML backend failed';
    }
    render();
  }

  function saveSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.events));
    window.trsExperimental = window.trsExperimental || {};
    window.trsExperimental.shareUrl = `${location.origin}${location.pathname}?data=${encodeURIComponent(btoa(JSON.stringify(state.events)))}`;
  }

  function snapshotForUndo() {
    state.undoStack.push(JSON.stringify(state.events));
    if (state.undoStack.length > UNDO_KEY_LIMIT) state.undoStack.shift();
  }

  function restoreSnapshot() {
    const snapshot = state.undoStack.pop();
    if (!snapshot) return;
    try {
      state.events = JSON.parse(snapshot);
      deriveTransport();
      saveSession();
      render();
    } catch (error) {
      console.error('TRS:undo restore failed', error);
    }
  }

  function deriveTransport() {
    state.transport.key = estimateKey(state.events);
    state.transport.meter = estimateMeter(state.events);
    state.transport.bpm = detectTempo(state.events, state.transport.bpm || 120);
  }

  function bindRange(el, key, format, out, parser = Number) {
    const value = parser(el.value);
    state.settings[key] = value;
    out.textContent = format(value);
    el.addEventListener('input', (e) => {
      const next = parser(e.target.value);
      state.settings[key] = next;
      out.textContent = format(next);
      if (key === 'inputGain' && state.gainNode) state.gainNode.gain.value = next;
    });
  }

  function bindControls() {
    els.startMicBtn.addEventListener('click', hooks.startAudio);
    els.stopMicBtn.addEventListener('click', hooks.stopAudio);
    els.connectMidiBtn.addEventListener('click', hooks.connectMidi);
    els.clearBtn.addEventListener('click', () => {
      snapshotForUndo();
      state.events = [];
      deriveTransport();
      saveSession();
      render();
    });

    bindRange(els.noiseGate, 'noiseGate', (v) => Number(v).toFixed(2), els.noiseGateValue);
    bindRange(els.latencyMs, 'latencyMs', (v) => `${v}ms`, els.latencyValue, Number);
    bindRange(els.inputGain, 'inputGain', (v) => Number(v).toFixed(2), els.inputGainValue, Number);
    bindRange(els.confidenceThreshold, 'confidenceThreshold', (v) => Number(v).toFixed(2), els.confidenceValue, Number);
    bindRange(els.quantizationStrength, 'quantizationStrength', (v) => Number(v).toFixed(2), els.quantValue, Number);

    els.profile.addEventListener('change', (e) => {
      state.settings.profile = e.target.value;
      render();
    });

    els.exportJsonBtn.addEventListener('click', () => {
      downloadFile('transcription.json', JSON.stringify(state.events, null, 2), 'application/json');
    });
    els.exportTxtBtn.addEventListener('click', () => {
      const text = state.events
        .map((e) => `${Math.round(e.startMs)}\t${Math.round(e.durationMs)}\t${midiToNoteName(e.pitchMidi)}\t${e.confidence.toFixed(2)}\t${e.source}`)
        .join('\n');
      downloadFile('transcription.txt', text, 'text/plain');
    });
    els.exportMusicXmlBtn.addEventListener('click', (event) => {
      if (event.shiftKey) {
        downloadFile('transcription.mid', exportMidi(state.events, state.transport.bpm), 'audio/midi');
        return;
      }
      downloadFile('transcription.musicxml', exportMusicXml(state.events, { bpm: state.transport.bpm, title: 'TRS Transcription' }), 'application/xml');
    });

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        restoreSnapshot();
      } else if (key === 's') {
        event.preventDefault();
        saveSession();
        render();
      }
    });
  }

  function hydrateFromSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) state.events = parsed;
      deriveTransport();
    } catch (error) {
      console.warn('TRS:session restore failed', error);
    }
  }

  function hydrateFromQuery() {
    try {
      const params = new URLSearchParams(location.search);
      const data = params.get('data');
      if (!data) return;
      const parsed = JSON.parse(atob(decodeURIComponent(data)));
      if (Array.isArray(parsed)) {
        state.events = parsed;
        deriveTransport();
        saveSession();
      }
    } catch (error) {
      console.warn('TRS:share link restore failed', error);
    }
  }

  function pushEvent(raw) {
    try {
      const event = quantizeEvent(raw, state.settings, state.transport.bpm);
      state.events = smartPruneEvents([...state.events, event], 500, 60000, 90);
      deriveTransport();
      saveSession();
      render();
    } catch (error) {
      console.error('TRS:pushEvent failure', error, raw);
    }
  }

  function onAudioChunk(samples, inputRate) {
    if (!state.basicPitch || state.backendMode !== 'ml') return;
    state.basicPitch.pushAudioChunk(samples, inputRate);
    maybeRunMlInference();
  }

  async function maybeRunMlInference(forceFlush = false) {
    if (!state.basicPitch || state.backendMode !== 'ml' || state.mlBusy) return;
    state.mlBusy = true;
    try {
      state.backendStatus = forceFlush ? 'Flushing final notes' : 'Processing live audio';
      const events = forceFlush
        ? await state.basicPitch.flush({
            profile: state.settings.profile,
            onsetThreshold: 0.45,
            frameThreshold: Math.max(0.18, state.settings.confidenceThreshold * 0.9),
          })
        : await state.basicPitch.process(performance.now(), {
            profile: state.settings.profile,
            onsetThreshold: 0.45,
            frameThreshold: Math.max(0.18, state.settings.confidenceThreshold * 0.9),
            inferenceIntervalMs: Math.max(350, state.settings.latencyMs * 4),
            stableTailMs: Math.max(250, state.settings.latencyMs * 2),
          });
      for (const event of events) pushEvent(event);
      state.backendStatus = state.transport.isListening ? 'Processing live audio' : 'Ready';
    } catch (error) {
      console.error('TRS:ML inference failure', error);
      state.backendMode = 'heuristic';
      state.backendLabel = 'Heuristic fallback';
      state.backendStatus = error?.message || 'Inference failed';
    } finally {
      state.mlBusy = false;
      render();
    }
  }

  function onAudioStopped() {
    if (!state.basicPitch || state.backendMode !== 'ml') return;
    maybeRunMlInference(true);
    state.basicPitch.reset();
    state.backendStatus = 'Ready';
  }

  function render() {
    const suffix = state.backendStatus ? ` · ${state.backendStatus}` : '';
    state.backendLabel = state.backendMode === 'ml'
      ? `Spotify Basic Pitch ONNX${suffix}`
      : `Heuristic fallback${suffix}`;
    renderApp(state, els);
  }
})();
