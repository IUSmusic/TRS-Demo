import { midiToNoteName } from './transcription.js';

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildMeasures(events, bpm = 120) {
  const divisions = 4;
  const beatMs = 60000 / Math.max(1, bpm);
  const measureBeats = 4;
  const measureMs = beatMs * measureBeats;
  const baseStart = events[0]?.startMs ?? 0;
  const measures = new Map();

  for (const event of events) {
    const relativeStart = Math.max(0, event.startMs - baseStart);
    const measureNumber = Math.floor(relativeStart / measureMs) + 1;
    const noteName = midiToNoteName(event.pitchMidi);
    const stepRaw = noteName.replace(/\d+/g, '');
    const octave = Math.floor(event.pitchMidi / 12) - 1;
    const step = stepRaw[0];
    const alter = stepRaw.includes('#') ? '<alter>1</alter>' : stepRaw.includes('b') ? '<alter>-1</alter>' : '';
    const duration = Math.max(1, Math.round((event.durationMs / beatMs) * divisions));
    const voice = event.staff === 1 ? 2 : 1;
    const entry = `<note><pitch><step>${step}</step>${alter}<octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><type>${duration >= 4 ? 'quarter' : 'eighth'}</type></note>`;
    if (!measures.has(measureNumber)) measures.set(measureNumber, []);
    measures.get(measureNumber).push(entry);
  }

  if (!measures.size) measures.set(1, ['<rest measure="yes"/>']);
  return [...measures.entries()].map(([number, notes], idx) => {
    const attrs = idx === 0
      ? `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`
      : '';
    return `<measure number="${number}">${attrs}${notes.join('')}</measure>`;
  }).join('');
}

export function exportMusicXml(events, meta = {}) {
  const title = xmlEscape(meta.title || 'Transcription');
  const bpm = meta.bpm || 120;
  const measures = buildMeasures(events, bpm);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function writeVarLen(value) {
  let buffer = value & 0x7F;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= ((value & 0x7F) | 0x80);
  }
  for (;;) {
    bytes.push(buffer & 0xFF);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

export function exportMidi(events, bpm = 120) {
  const ticksPerQuarter = 480;
  const beatMs = 60000 / Math.max(1, bpm);
  const msToTicks = (ms) => Math.max(1, Math.round((ms / beatMs) * ticksPerQuarter));
  const ordered = [];
  const baseStart = events[0]?.startMs ?? 0;

  for (const e of events) {
    const start = Math.max(0, e.startMs - baseStart);
    ordered.push({ time: start, type: 'on', note: e.pitchMidi, velocity: Math.max(24, Math.min(127, e.velocity || Math.round((e.confidence || 0.8) * 110))) });
    ordered.push({ time: start + Math.max(60, e.durationMs), type: 'off', note: e.pitchMidi, velocity: 0 });
  }

  ordered.sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));
  const track = [];
  const tempo = Math.round(60000000 / Math.max(1, bpm));
  track.push(...writeVarLen(0), 0xFF, 0x51, 0x03, (tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF);
  let lastTicks = 0;
  for (const evt of ordered) {
    const ticks = msToTicks(evt.time);
    const delta = Math.max(0, ticks - lastTicks);
    lastTicks = ticks;
    track.push(...writeVarLen(delta), evt.type === 'on' ? 0x90 : 0x80, evt.note & 0x7F, evt.velocity & 0x7F);
  }
  track.push(...writeVarLen(0), 0xFF, 0x2F, 0x00);

  const header = [
    0x4D, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ticksPerQuarter >> 8) & 0xFF, ticksPerQuarter & 0xFF,
  ];
  const trackHeader = [
    0x4D, 0x54, 0x72, 0x6B,
    (track.length >> 24) & 0xFF,
    (track.length >> 16) & 0xFF,
    (track.length >> 8) & 0xFF,
    track.length & 0xFF,
  ];
  return new Uint8Array([...header, ...trackHeader, ...track]);
}

export function downloadFile(name, content, type) {
  const blob = content instanceof Uint8Array ? new Blob([content], { type }) : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 250);
}
