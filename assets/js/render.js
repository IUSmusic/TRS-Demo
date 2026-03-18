import { estimateChordLabel, groupChordWindows, midiToNoteName } from './transcription.js';

function patchText(el, value) {
  const next = String(value);
  if (el && el.textContent !== next) el.textContent = next;
}

function ensureChildCount(container, count, factory) {
  while (container.children.length < count) container.appendChild(factory());
  while (container.children.length > count) container.removeChild(container.lastElementChild);
}

function makeRecentRow() {
  const tr = document.createElement('tr');
  for (let i = 0; i < 4; i++) tr.appendChild(document.createElement('td'));
  return tr;
}

function makeTimelineBar() {
  const div = document.createElement('div');
  div.className = 'timeline-bar';
  return div;
}

function makeNoteCard() {
  const card = document.createElement('div');
  card.className = 'note-card';
  const spacer = document.createElement('div');
  spacer.className = 'note-spacer';
  const stem = document.createElement('div');
  stem.className = 'stem';
  const head = document.createElement('div');
  head.className = 'note-head';
  const label = document.createElement('div');
  label.className = 'note-label';
  const meta = document.createElement('div');
  meta.className = 'note-meta';
  card.append(spacer, stem, head, label, meta);
  return card;
}

function renderRecentNotes(els, events) {
  const recent = [...events].slice(-12).reverse();
  ensureChildCount(els.recentNotesBody, recent.length, makeRecentRow);
  recent.forEach((event, idx) => {
    const row = els.recentNotesBody.children[idx];
    const cells = row.children;
    patchText(cells[0], midiToNoteName(event.pitchMidi));
    patchText(cells[1], `${Math.round(event.durationMs)}ms`);
    patchText(cells[2], event.confidence.toFixed(2));
    patchText(cells[3], event.source);
  });
}

function renderTimeline(els, events) {
  const recent = [...events].slice(-48);
  ensureChildCount(els.timeline, recent.length, makeTimelineBar);
  recent.forEach((event, idx) => {
    const bar = els.timeline.children[idx];
    const height = `${Math.max(10, Math.min(110, event.durationMs / 8))}px`;
    if (bar.style.height !== height) bar.style.height = height;
    const title = `${midiToNoteName(event.pitchMidi)} ${Math.round(event.durationMs)}ms`;
    if (bar.title !== title) bar.title = title;
  });
}

function renderScore(els, events) {
  const recent = [...events].slice(-16);
  if (!recent.length) {
    if (!els.scoreView.dataset.empty) {
      els.scoreView.innerHTML = '<div class="small">Play or sing into the app to see notes appear here.</div>';
      els.scoreView.dataset.empty = '1';
      delete els.scoreView.dataset.ready;
    }
    return;
  }

  if (!els.scoreView.dataset.ready) {
    els.scoreView.innerHTML = '<div class="staff"><div class="staff-lines"></div><div class="note-lane"></div></div>';
    els.scoreView.dataset.ready = '1';
    delete els.scoreView.dataset.empty;
  }

  const noteLane = els.scoreView.querySelector('.note-lane');
  ensureChildCount(noteLane, recent.length, makeNoteCard);
  recent.forEach((event, idx) => {
    const card = noteLane.children[idx];
    const spacer = card.children[0];
    const label = card.children[3];
    const meta = card.children[4];
    const height = `${Math.max(34, Math.min(210, 32 + (event.pitchMidi - 48) * 2))}px`;
    if (spacer.style.height !== height) spacer.style.height = height;
    const title = `${midiToNoteName(event.pitchMidi)} ${Math.round(event.durationMs)}ms`;
    if (card.title !== title) card.title = title;
    patchText(label, midiToNoteName(event.pitchMidi));
    patchText(meta, event.source);
  });
}

export function renderApp(state, els) {
  patchText(els.keyBadge, state.transport.key);
  patchText(els.meterBadge, state.transport.meter);
  patchText(els.bpmBadge, state.transport.bpm);
  patchText(els.backendBadge, state.backendLabel || 'Experimental');
  patchText(els.backendLabel, `${state.backendLabel || 'Experimental'} · standalone build`);
  patchText(els.micLevel, state.audioLevel.toFixed(3));
  patchText(els.listeningValue, state.transport.isListening ? 'Audio Live' : 'Idle');
  patchText(els.midiInputsValue, state.midiInputs.length ? state.midiInputs.join(', ') : 'MIDI off');
  patchText(els.lastChordValue, estimateChordLabel(groupChordWindows(state.events).at(-1) || []) || '—');
  patchText(els.eventsCount, state.events.length);
  renderRecentNotes(els, state.events);
  renderTimeline(els, state.events);
  renderScore(els, state.events);
}
