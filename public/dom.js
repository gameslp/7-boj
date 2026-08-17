// Wspólne klocki interfejsu: budowanie DOM, flagi zawodników, drobne formatowanie.

let PLAYERS = [];

export function setPlayers(players) {
  PLAYERS = players;
}

export function playerName(index) {
  return PLAYERS[index]?.name ?? '—';
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style') node.setAttribute('style', value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const INK_DARK = '#1a1710';
const INK_LIGHT = '#f4eee0';

function contrastRatio(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Inicjały biorą ten z dwóch kolorów, który realnie lepiej kontrastuje z barwą flagi. */
function inkFor(hex) {
  const base = luminance(hex);
  return contrastRatio(base, luminance(INK_DARK)) >= contrastRatio(base, luminance(INK_LIGHT))
    ? INK_DARK
    : INK_LIGHT;
}

/**
 * Flaga zawodnika. Inicjały siedzą wyśrodkowane w polu barwy głównej,
 * a nie doklejone do krawędzi — dlatego monogram jest osobnym elementem.
 */
export function flag(playerIndex, size = '') {
  const player = PLAYERS[playerIndex];
  if (!player) return el('span', { class: 'flag flag--empty', text: '?' });
  return el(
    'span',
    {
      class: `flag${size ? ` flag--${size}` : ''}`,
      style: `--c1:${player.c1};--c2:${player.c2};--c-ink:${inkFor(player.c1)}`,
      title: player.name,
    },
    el('span', { class: 'flag__mono', text: player.mono }),
  );
}

/** Flaga plus imię — najczęstszy sposób pokazania zawodnika. */
export function who(playerIndex, { size = '', muted = false } = {}) {
  return el(
    'span',
    { class: `who${muted ? ' who--muted' : ''}` },
    flag(playerIndex, size),
    el('span', { class: 'who__name', text: playerName(playerIndex) }),
  );
}

export function clockOf(timestamp) {
  return new Date(timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

export function chip(text, status) {
  return el('span', { class: 'chip', 'data-status': status ?? null, text });
}

const STATUS_LABEL = {
  setup: 'Ustawianie składu',
  ready: 'Wylosowane, czeka na start',
  live: 'W trakcie',
  done: 'Rozegrane',
};

export function statusChip(status) {
  const tone = status === 'done' ? 'done' : status === 'live' ? 'live' : 'open';
  return chip(STATUS_LABEL[status] ?? 'Przed nami', tone);
}

export function button(text, { onClick, kind = '', disabled = false, title = null } = {}) {
  return el('button', {
    class: `btn${kind ? ` btn--${kind}` : ''}`,
    type: 'button',
    disabled,
    title,
    text,
    onclick: onClick,
  });
}
