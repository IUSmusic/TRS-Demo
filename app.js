(() => {
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
    raf: 0,
    lastActive: 0,
    noteStart: 0,
    activeMidi: null,
    midiAccess: null,
    activeNotes: new Map(),
  };

  const els = {
    startMicBtn: document.getElementById('startMicBtn'),
    stopMicBtn: document.getElementById('stopMicBtn'),
    connectMidiBtn: document.getElementById('connectMidiBtn'),
    clearBtn: document.getElementById('clearBtn'),
    noiseGate: document.getElementById('noiseGate'),
    latencyMs: document.getElementById('latencyMs'),
    inputGain: document.getElementById('inputGain'),
    confidenceThreshold: document.getElementById('confidenceThreshold'),
    quantizationStrength: document.getElementById('quantizationStrength'),
    profile: document.getElementById('profile'),
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
    micLevel: document.getElementById('micLevel'),
    listeningValue: document.getElementById('listeningValue'),
    midiInputsValue: document.getElementById('midiInputsValue'),
    lastChordValue: document.getElementById('lastChordValue'),
    eventsCount: document.getElementById('eventsCount'),
    recentNotesBody: document.getElementById('recentNotesBody'),
    timeline: document.getElementById('timeline'),
    scoreView: document.getElementById('scoreView'),
  };

  loadTheme();
  bindControls();
  render();

  function bindControls() {
    els.startMicBtn.addEventListener('click', startAudio);
    els.stopMicBtn.addEventListener('click', stopAudio);
    els.connectMidiBtn.addEventListener('click', connectMidi);
    els.clearBtn.addEventListener('click', () => {
      state.events = [];
      render();
    });

    bindRange(els.noiseGate, 'noiseGate', (v) => v.toFixed(2), els.noiseGateValue);
    bindRange(els.latencyMs, 'latencyMs', (v) => `${v}ms`, els.latencyValue, Number);
    bindRange(els.inputGain, 'inputGain', (v) => Number(v).toFixed(2), els.inputGainValue, Number);
    bindRange(els.confidenceThreshold, 'confidenceThreshold', (v) => Number(v).toFixed(2), els.confidenceValue, Number);
    bindRange(els.quantizationStrength, 'quantizationStrength', (v) => Number(v).toFixed(2), els.quantValue, Number);
    els.profile.addEventListener('change', (e) => { state.settings.profile = e.target.value; });
    els.themeSelect.addEventListener('change', (e) => setTheme(e.target.value));

    document.getElementById('exportJsonBtn').addEventListener('click', () => downloadFile('transcription.json', JSON.stringify(state.events, null, 2), 'application/json'));
    document.getElementById('exportTxtBtn').addEventListener('click', () => downloadFile('transcription.txt', state.events.map((e) => `${Math.round(e.startMs)}\t${Math.round(e.durationMs)}\t${midiToNoteName(e.pitchMidi)}\t${e.confidence.toFixed(2)}\t${e.source}`).join('\n'), 'text/plain'));
    document.getElementById('exportMusicXmlBtn').addEventListener('click', () => downloadFile('transcription.musicxml', exportMusicXml(state.events), 'application/xml'));
  }

  function bindRange(el, key, format, out, parser = Number) {
    el.addEventListener('input', (e) => {
      const value = parser(e.target.value);
      state.settings[key] = value;
      out.textContent = format(value);
      if (key === 'inputGain' && state.gainNode) state.gainNode.gain.value = value;
    });
  }

  async function startAudio() {
    try {
      stopAudio();
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      state.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: state.settings.latencyMs < 100 ? 'interactive' : 'balanced' });
      await state.ctx.resume();
      const source = state.ctx.createMediaStreamSource(state.stream);
      state.analyser = state.ctx.createAnalyser();
      state.analyser.fftSize = 2048;
      state.gainNode = state.ctx.createGain();
      state.gainNode.gain.value = state.settings.inputGain;
      source.connect(state.gainNode).connect(state.analyser);
      state.transport.isListening = true;
      tickAudio();
      render();
    } catch (error) {
      alert(`Mic start failed: ${error.message || error}`);
    }
  }

  function stopAudio() {
    cancelAnimationFrame(state.raf);
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    if (state.ctx) state.ctx.close();
    state.stream = null;
    state.ctx = null;
    state.analyser = null;
    state.gainNode = null;
    state.transport.isListening = false;
    state.activeMidi = null;
    render();
  }

  function tickAudio() {
    if (!state.analyser || !state.ctx) return;
    const timeData = new Float32Array(state.analyser.fftSize);
    state.analyser.getFloatTimeDomainData(timeData);
    const rms = Math.sqrt(timeData.reduce((sum, x) => sum + x * x, 0) / timeData.length);
    state.audioLevel = rms;
    const freq = autoCorrelate(timeData, state.ctx.sampleRate);
    const conf = Math.min(1, rms * 10);
    const open = rms >= state.settings.noiseGate && freq > 0 && conf >= state.settings.confidenceThreshold;
    const now = performance.now();
    if (open) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      if (state.activeMidi === null) {
        state.activeMidi = midi;
        state.noteStart = now;
      } else if (Math.abs(midi - state.activeMidi) >= 1) {
        pushEvent({
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
      pushEvent({
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
    render();
    state.raf = requestAnimationFrame(tickAudio);
  }

  async function connectMidi() {
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
          const [status, note, velocity = 0] = message.data;
          const command = status & 0xf0;
          const now = performance.now();
          if (command === 0x90 && velocity > 0) {
            state.activeNotes.set(note, { startMs: now, velocity });
          } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            const active = state.activeNotes.get(note);
            if (!active) return;
            state.activeNotes.delete(note);
            pushEvent({
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
        };
      }
      state.midiInputs = names;
      render();
    } catch (error) {
      alert(`MIDI connect failed: ${error.message || error}`);
    }
  }

  function pushEvent(raw) {
    const event = quantizeEvent(raw, state.settings, state.transport.bpm);
    state.events = [...state.events, event].slice(-200);
    state.transport.key = estimateKey(state.events);
    state.transport.meter = estimateMeter(state.events);
    render();
  }

  function render() {
    els.keyBadge.textContent = state.transport.key;
    els.meterBadge.textContent = state.transport.meter;
    els.bpmBadge.textContent = String(state.transport.bpm);
    els.backendBadge.textContent = 'Heuristic';
    els.micLevel.textContent = state.audioLevel.toFixed(3);
    els.listeningValue.textContent = state.transport.isListening ? 'Audio Live' : 'Idle';
    els.midiInputsValue.textContent = state.midiInputs.length ? state.midiInputs.join(', ') : 'MIDI off';
    els.lastChordValue.textContent = estimateChordLabel(groupChordWindows(state.events).at(-1) || []) || '—';
    els.eventsCount.textContent = String(state.events.length);

    const recent = [...state.events].slice(-12).reverse();
    els.recentNotesBody.innerHTML = recent.map((event) => `
      <tr>
        <td>${midiToNoteName(event.pitchMidi)}</td>
        <td>${Math.round(event.durationMs)}ms</td>
        <td>${event.confidence.toFixed(2)}</td>
        <td>${event.source}</td>
      </tr>`).join('');

    els.timeline.innerHTML = [...state.events].slice(-48).map((event) =>
      `<div class="timeline-bar" style="height:${Math.max(10, Math.min(110, event.durationMs / 8))}px" title="${midiToNoteName(event.pitchMidi)} ${Math.round(event.durationMs)}ms"></div>`
    ).join('');

    const recentScore = [...state.events].slice(-16);
    if (!recentScore.length) {
      els.scoreView.innerHTML = '<div class="small">Play or sing into the app to see notes appear here.</div>';
    } else {
      els.scoreView.innerHTML = `
        <div class="staff">
          <div class="staff-lines"></div>
          <div class="note-lane">
            ${recentScore.map((event) => `
              <div class="note-card" title="${midiToNoteName(event.pitchMidi)} ${Math.round(event.durationMs)}ms">
                <div style="height:${Math.max(34, Math.min(210, 32 + (event.pitchMidi - 48) * 2))}px"></div>
                <div class="stem"></div>
                <div class="note-head"></div>
                <div class="note-label">${midiToNoteName(event.pitchMidi)}</div>
                <div class="note-meta">${event.source}</div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }
  }


  function loadTheme() {
    const saved = localStorage.getItem('ius-theme') || 'dark';
    setTheme(saved);
    if (els.themeSelect) els.themeSelect.value = saved;
  }

  function setTheme(theme) {
    const next = theme === 'contrast' ? 'contrast' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ius-theme', next);
    if (els.themeSelect && els.themeSelect.value !== next) els.themeSelect.value = next;
  }

  function quantizeEvent(event, settings, bpm = 120) {
    const beatMs = 60000 / bpm;
    const grid = beatMs / 4;
    const strength = settings.quantizationStrength;
    const snap = (value) => {
      const target = Math.round(value / grid) * grid;
      return value + (target - value) * strength;
    };
    return { ...event, startMs: snap(event.startMs), durationMs: Math.max(grid / 2, snap(event.durationMs)) };
  }

  function groupChordWindows(events, toleranceMs = 60) {
    const sorted = [...events].sort((a, b) => a.startMs - b.startMs);
    const groups = [];
    for (const event of sorted) {
      const last = groups[groups.length - 1];
      if (!last || Math.abs(last[0].startMs - event.startMs) > toleranceMs) groups.push([event]);
      else last.push(event);
    }
    return groups;
  }

  function estimateChordLabel(windowEvents) {
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

  function estimateKey(events) {
    if (!events.length) return 'C major';
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const counts = new Array(12).fill(0);
    for (const e of events) counts[e.pitchMidi % 12] += 1;
    const best = counts.indexOf(Math.max(...counts));
    return `${names[best]} major`;
  }

  function estimateMeter() { return '4/4'; }

  function midiToNoteName(midi) {
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const name = names[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${name}${octave}`;
  }

  function exportMusicXml(events) {
    const notes = events.map((e) => {
      const noteName = midiToNoteName(e.pitchMidi);
      const stepRaw = noteName.replace(/\d+/g, '');
      const octave = Math.floor(e.pitchMidi / 12) - 1;
      const step = stepRaw[0];
      const alter = stepRaw.includes('#') ? '<alter>1</alter>' : stepRaw.includes('b') ? '<alter>-1</alter>' : '';
      return `<note><pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch><duration>${Math.max(1, Math.round(e.durationMs / 120))}</duration></note>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list><part id="P1"><measure number="1">${notes}</measure></part></score-partwise>`;
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function autoCorrelate(buffer, sampleRate) {
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
})();
