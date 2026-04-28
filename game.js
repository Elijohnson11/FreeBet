// ═══════════════════════════════════════════
//   FreeBet — game.js
// ═══════════════════════════════════════════

// ───── MULTIPLAYER / SOCKET ─────
const SERVER_URL = window.FREEBET_SERVER || 'https://freebet-production.up.railway.app';

let socket          = null;
let roomCode        = null;
let localPlayerId   = null; // set when this device sits down
let _applyingRemote = false; // prevent push loops

// Map ↔ JSON helpers (state.bet.participants is a Map)
function serializeState(s) {
  return JSON.parse(JSON.stringify(s, (_, v) => {
    if (v instanceof Map) return { __map: Array.from(v.entries()) };
    return v;
  }));
}
function deserializeState(raw) {
  return JSON.parse(JSON.stringify(raw), (_, v) => {
    if (v && typeof v === 'object' && Array.isArray(v.__map)) return new Map(v.__map);
    return v;
  });
}

// Push local state to server → broadcasts to all peers
function pushState() {
  if (_applyingRemote || !socket || !roomCode) return;
  socket.emit('push-state', { state: serializeState(state) });
}

// Receive state from server and re-render without re-pushing
function applyRemoteState(remote) {
  _applyingRemote = true;
  try {
    const incoming  = deserializeState(remote);
    const wasInGame = (state.phase !== 'LOBBY');
    const nowInGame = (incoming.phase !== 'LOBBY');
    state = incoming;

    if (!wasInGame && nowInGame) {
      document.getElementById('lobby').classList.remove('active');
      document.getElementById('game').classList.add('active');
    } else if (wasInGame && !nowInGame) {
      document.getElementById('game').classList.remove('active');
      document.getElementById('lobby').classList.add('active');
    }

    if (nowInGame) {
      renderGame();
      renderLog();
    } else {
      renderLobby();
    }
  } finally {
    _applyingRemote = false;
  }
}

// ── Room Entry screen logic ──
function initRoomEntry() {
  const createBtn      = document.getElementById('re-create-btn');
  const joinBtn        = document.getElementById('re-join-btn');
  const codeInput      = document.getElementById('re-code-input');
  const statusEl       = document.getElementById('re-status');
  const codeDisplay    = document.getElementById('re-code-display');
  const codeValueEl    = document.getElementById('re-code-value');
  const copyBtn        = document.getElementById('re-copy-btn');
  const enterLobbyBtn  = document.getElementById('re-enter-lobby-btn');
  const playerCountEl  = document.getElementById('re-player-count');
  let   connectedCount = 1;

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className   = 're-status' + (isError ? ' error' : '');
  }

  function connectSocket(onReady) {
    if (socket?.connected) { onReady(); return; }
    setStatus('<span class="re-spinner"></span> Connecting…');
    statusEl.innerHTML = '<span class="re-spinner"></span> Connecting…';
    socket = io(SERVER_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      setStatus('');
      onReady();
    });
    socket.on('connect_error', () => {
      setStatus('⚠ Could not reach server. Check your connection.', true);
    });

    // Receive state updates from peers
    socket.on('state-update', ({ state: remote }) => {
      applyRemoteState(remote);
    });

    socket.on('peer-joined', ({ count }) => {
      connectedCount = count;
      if (playerCountEl) playerCountEl.textContent = count;
    });

    socket.on('peer-left', ({ count }) => {
      connectedCount = count;
      if (playerCountEl) playerCountEl.textContent = count;
    });
  }

  // ── CREATE ──
  createBtn.addEventListener('click', () => {
    createBtn.disabled = true;
    connectSocket(() => {
      socket.emit('create-room', ({ code }) => {
        roomCode = code;
        sessionStorage.setItem('freebet_room', code);
        document.querySelector('.re-cards-row').style.display = 'none';
        codeDisplay.style.display = 'flex';
        codeDisplay.style.flexDirection = 'column';
        codeValueEl.textContent = code;
        setStatus('');
      });
    });
  });

  // ── JOIN ──
  function doJoin() {
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      codeInput.focus();
      codeInput.style.borderColor = 'rgba(200,50,50,0.6)';
      setTimeout(() => codeInput.style.borderColor = '', 700);
      return;
    }
    joinBtn.disabled = true;
    connectSocket(() => {
      socket.emit('join-room', { code }, ({ ok, error, state: serverState }) => {
        if (error) {
          setStatus('⚠ ' + error, true);
          joinBtn.disabled = false;
          return;
        }
        roomCode = code;
        sessionStorage.setItem('freebet_room', code);
        if (serverState) applyRemoteState(serverState);
        enterLobbyFromEntry();
      });
    });
  }
  joinBtn.addEventListener('click', doJoin);
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  // ── COPY LINK ──
  copyBtn.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?code=${roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => copyBtn.textContent = '📋 Copy Link', 2000);
    });
  });

  // ── ENTER LOBBY (after creating) ──
  enterLobbyBtn.addEventListener('click', enterLobbyFromEntry);

  function enterLobbyFromEntry() {
    document.getElementById('room-entry').classList.remove('active');
    document.getElementById('lobby').classList.add('active');
  }

  // ── Auto-join from URL param ?code=XXXXXX ──
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) {
    codeInput.value = urlCode.toUpperCase();
    setTimeout(doJoin, 300);
    return;
  }

  // ── Reconnect after refresh ──
  const savedRoom   = sessionStorage.getItem('freebet_room');
  const savedPlayer = sessionStorage.getItem('freebet_player');
  if (savedRoom) {
    connectSocket(() => {
      socket.emit('join-room', { code: savedRoom }, ({ ok, error, state: serverState }) => {
        if (error) {
          sessionStorage.removeItem('freebet_room');
          sessionStorage.removeItem('freebet_player');
          return;
        }
        roomCode = savedRoom;
        if (savedPlayer) localPlayerId = savedPlayer;
        if (serverState) applyRemoteState(serverState);
        // Go straight to game or lobby based on current phase
        document.getElementById('room-entry').classList.remove('active');
        const incoming = serverState ? deserializeState(serverState) : null;
        if (incoming && incoming.phase !== 'LOBBY') {
          document.getElementById('game').classList.add('active');
        } else {
          document.getElementById('lobby').classList.add('active');
        }
      });
    });
  }
}

// ───── CONSTANTS ─────

const SHIRT_COLORS = [
  { name: 'Crimson',   hex: '#c0392b' },
  { name: 'Navy',      hex: '#1a3a6b' },
  { name: 'Emerald',   hex: '#1e8449' },
  { name: 'Plum',      hex: '#6c3483' },
  { name: 'Tangerine', hex: '#d35400' },
  { name: 'Hot Pink',  hex: '#c0155c' },
  { name: 'Teal',      hex: '#0e7f6e' },
  { name: 'Slate',     hex: '#2e4057' },
];

const SEAT_LOBBY_POS = [
  { left: '50%',  top: '106%' },
  { left: '95%',  top: '74%'  },
  { left: '90%',  top: '8%'   },
  { left: '10%',  top: '8%'   },
  { left: '5%',   top: '74%'  },
];

// ───── STATE ─────

let state = {
  phase:          'LOBBY',   // LOBBY | IDLE | BET_ACTIVE | BETTING_ROUND | BET_CLOSED | RESOLVING
  players:        [],
  activePlayerId: null,
  bet:            null,
  log:            [],
};

let _raiseAmt = 0; // current raise-to amount shown in raise UI

// ───── LOCAL STORAGE ─────

const SAVE_KEY = 'freebet_v1';

function saveSession() {
  if (!state.players.length) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      savedAt: Date.now(),
      players: state.players.map(p => ({
        name:          p.name,
        color:         p.color,
        glasses:       p.glasses  || false,
        cigar:         p.cigar    || false,
        wins:          p.wins          || 0,
        betsPlayed:    p.betsPlayed    || 0,
        bestStreak:    p.bestStreak    || 0,
        allTimeEarned: p.allTimeEarned || 0,
      })),
    }));
  } catch(e) {}
}

function loadSavedPlayers() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).players || [];
  } catch(e) { return []; }
}

function rejoinPlayer(savedName) {
  if (state.players.length >= 5) return;
  const saved = loadSavedPlayers().find(p => p.name.toLowerCase() === savedName.toLowerCase());
  if (!saved) return;
  if (state.players.some(p => p.name.toLowerCase() === savedName.toLowerCase())) return;

  const taken = state.players.map(p => p.color);
  let color   = saved.color;
  if (taken.includes(color)) color = SHIRT_COLORS.find(c => !taken.includes(c.hex))?.hex || SHIRT_COLORS[0].hex;

  state.players.push({
    id: uid(), name: saved.name, color, coins: 20,
    seat:          state.players.length,
    glasses:       saved.glasses,
    cigar:         saved.cigar,
    allTimeEarned: saved.allTimeEarned,
    wins:          saved.wins,
    betsPlayed:    saved.betsPlayed,
    currentStreak: 0,
    bestStreak:    saved.bestStreak,
  });
  SFX.sitDown();
  renderLobby();
}

function renderLastSession() {
  const wrap = document.getElementById('last-session-wrap');
  if (!wrap) return;
  const seated    = new Set(state.players.map(p => p.name.toLowerCase()));
  const available = loadSavedPlayers().filter(p => !seated.has(p.name.toLowerCase()));
  if (!available.length || state.players.length >= 5) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const list = document.getElementById('last-session-players');
  list.innerHTML = available.map(p => {
    const rate = p.betsPlayed ? Math.round(p.wins / p.betsPlayed * 100) : 0;
    return `<button class="ls-pill" data-name="${escHtml(p.name)}" title="${p.wins} wins · ${rate}% win rate · ${p.bestStreak} best streak">
      <span class="ls-dot" style="background:${p.color}"></span>
      <span class="ls-name">${escHtml(p.name)}</span>
      <span class="ls-stat">${p.wins}W · ${rate}%</span>
    </button>`;
  }).join('');
  list.querySelectorAll('.ls-pill').forEach(btn =>
    btn.addEventListener('click', () => rejoinPlayer(btn.dataset.name))
  );
}

// ───── UTILITIES ─────

function uid()          { return Math.random().toString(36).slice(2, 9); }
function capitalize(s)  { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function getPlayer(id)  { return state.players.find(p => p.id === id); }
function getActivePlayer() { return getPlayer(state.activePlayerId); }

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addLog(msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
  renderLog();
}

// ───── CHARACTER SVG ─────

let _svgN = 0;

function characterSVG(shirtColor, size = 80, acc = {}) {
  const id   = `sv${_svgN++}`;
  const skin = '#FFCF9E';
  const skinSh = '#E09A50';
  const skinHi = '#FFF0D8';
  const hair = '#1a0e06';
  const w = size, h = Math.round(size * 1.22);

  // ── GLASSES — round opaque black shades ──
  const glassesHTML = acc.glasses ? `
    <circle cx="34" cy="38" r="12" fill="#0d0d0d"/>
    <circle cx="66" cy="38" r="12" fill="#0d0d0d"/>
    <circle cx="34" cy="38" r="12" fill="none" stroke="#050505" stroke-width="2.5"/>
    <circle cx="66" cy="38" r="12" fill="none" stroke="#050505" stroke-width="2.5"/>
    <line x1="46" y1="38" x2="54" y2="38" stroke="#050505" stroke-width="3"/>
    <line x1="22" y1="38" x2="14" y2="41" stroke="#050505" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="78" y1="38" x2="86" y2="41" stroke="#050505" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M26,31 Q31,28 36,31" stroke="rgba(255,255,255,0.6)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M58,31 Q63,28 68,31" stroke="rgba(255,255,255,0.6)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  ` : '';

  // ── CIGAR — chunky, vivid ──
  const cigarHTML = acc.cigar ? `
    <g transform="rotate(-14,65,60)">
      <rect x="62" y="56" width="30" height="9" rx="4.5" fill="#3e2606"/>
      <rect x="62" y="56" width="28" height="9" rx="4.5" fill="#7a5c14" opacity="0.9"/>
      <rect x="72" y="56" width="8" height="9" rx="1.5" fill="#d49010"/>
      <rect x="72" y="56" width="8" height="9" rx="1.5" fill="none" stroke="#f5c840" stroke-width="1.3"/>
      <ellipse cx="94" cy="60.5" rx="5" ry="4.5" fill="#d2cec8"/>
      <ellipse cx="91" cy="60.5" rx="4.5" ry="4.5" fill="#ff3300" opacity="0.95"/>
      <ellipse cx="91" cy="60.5" rx="2.5" ry="2.5" fill="#ff7700"/>
      <ellipse cx="91" cy="60.5" rx="1.2" ry="1.2" fill="#ffe000"/>
    </g>
    <g transform="translate(92,42)">
      <path d="M0,0 Q8,-10 2,-22 Q-4,-30 3,-40" stroke="rgba(235,235,235,0.92)" stroke-width="4" fill="none" stroke-linecap="round">
        <animate attributeName="opacity" values="0;0.92;0.65;0" dur="2.1s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0,0;-5,-8;-10,-18" dur="2.1s" repeatCount="indefinite" additive="sum"/>
      </path>
      <path d="M5,-5 Q12,-15 7,-26 Q2,-33 9,-42" stroke="rgba(215,215,215,0.65)" stroke-width="3" fill="none" stroke-linecap="round">
        <animate attributeName="opacity" values="0;0.65;0.35;0" begin="1.05s" dur="2.1s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0,0;4,-7;9,-16" begin="1.05s" dur="2.1s" repeatCount="indefinite" additive="sum"/>
      </path>
    </g>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 122" width="${w}" height="${h}">
  <defs>
    <radialGradient id="sg${id}" cx="36%" cy="30%" r="64%">
      <stop offset="0%"   stop-color="${skinHi}"/>
      <stop offset="60%"  stop-color="${skin}"/>
      <stop offset="100%" stop-color="${skinSh}"/>
    </radialGradient>
    <filter id="bl${id}"><feGaussianBlur stdDeviation="1.5"/></filter>
  </defs>

  <!-- Shadow -->
  <ellipse cx="50" cy="120" rx="26" ry="3.5" fill="rgba(0,0,0,0.4)" filter="url(#bl${id})"/>

  <!-- Arms — chunky, rounded, shirt color -->
  <path d="M33,80 Q18,96 15,116" stroke="${shirtColor}" stroke-width="18" fill="none" stroke-linecap="round"/>
  <path d="M67,80 Q82,96 85,116" stroke="${shirtColor}" stroke-width="18" fill="none" stroke-linecap="round"/>

  <!-- Hands -->
  <circle cx="15" cy="116" r="9" fill="url(#sg${id})"/>
  <circle cx="85" cy="116" r="9" fill="url(#sg${id})"/>

  <!-- Body — simple rounded block in shirt color -->
  <path d="M28,118 L26,84 Q25,72 50,70 Q75,72 74,84 L72,118 Z" fill="${shirtColor}"/>
  <path d="M74,84 L72,118 Q76,100 73,72 Z" fill="rgba(0,0,0,0.14)"/>
  <path d="M26,84 L28,118 Q24,100 27,72 Z" fill="rgba(255,255,255,0.08)"/>

  <!-- Collar / shirt detail -->
  <path d="M42,71 L50,83 L58,71 Q54,66 50,68 Q46,66 42,71 Z" fill="rgba(255,255,255,0.25)"/>
  <path d="M46,71 L50,80 L54,71" stroke="rgba(0,0,0,0.12)" stroke-width="1" fill="none"/>

  <!-- Neck -->
  <rect x="43" y="67" width="14" height="10" rx="5" fill="url(#sg${id})"/>

  <!-- Ears — round, simple -->
  <circle cx="15" cy="38" r="8" fill="url(#sg${id})"/>
  <circle cx="85" cy="38" r="8" fill="url(#sg${id})"/>
  <circle cx="15" cy="38" r="5" fill="${skinSh}" opacity="0.25"/>
  <circle cx="85" cy="38" r="5" fill="${skinSh}" opacity="0.25"/>

  <!-- BIG ROUND HEAD — chibi style, hero of the design -->
  <circle cx="50" cy="38" r="34" fill="url(#sg${id})"/>
  <!-- Very subtle right shadow -->
  <ellipse cx="67" cy="40" rx="18" ry="30" fill="${skinSh}" opacity="0.08"/>

  <!-- HAIR — neat, rounded cap -->
  <path d="M16,30 Q17,4 50,4 Q83,4 84,30 Q78,10 50,11 Q22,10 16,30 Z" fill="${hair}"/>
  <path d="M16,30 Q11,44 14,56 Q12,38 19,22" fill="${hair}"/>
  <path d="M84,30 Q89,44 86,56 Q88,38 81,22" fill="${hair}"/>
  <!-- Hair sheen -->
  <path d="M30,6 Q50,3 68,7 Q50,5 30,6 Z" fill="rgba(200,140,60,0.22)"/>

  <!-- EYEBROWS — friendly, equal -->
  <path d="M23,24 Q33,19 43,23" stroke="${hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  <path d="M57,23 Q67,19 77,24" stroke="${hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>

  <!-- EYES — big round cartoon circles, the whole vibe -->
  <!-- Whites with thin outline -->
  <circle cx="34" cy="38" r="11" fill="white"/>
  <circle cx="66" cy="38" r="11" fill="white"/>
  <circle cx="34" cy="38" r="11" fill="none" stroke="${hair}" stroke-width="1.8"/>
  <circle cx="66" cy="38" r="11" fill="none" stroke="${hair}" stroke-width="1.8"/>
  <!-- Iris — bright, friendly blue -->
  <circle cx="34" cy="39" r="7" fill="#5a9ce8"/>
  <circle cx="66" cy="39" r="7" fill="#5a9ce8"/>
  <!-- Iris inner depth -->
  <circle cx="34" cy="39" r="7" fill="rgba(0,0,40,0.15)"/>
  <circle cx="66" cy="39" r="7" fill="rgba(0,0,40,0.15)"/>
  <!-- Pupils -->
  <circle cx="34" cy="39.5" r="4" fill="#0c0c18"/>
  <circle cx="66" cy="39.5" r="4" fill="#0c0c18"/>
  <!-- Big main shine — makes them alive -->
  <circle cx="37" cy="35.5" r="3.4" fill="white"/>
  <circle cx="69" cy="35.5" r="3.4" fill="white"/>
  <!-- Small lower shine -->
  <circle cx="32" cy="43" r="1.5" fill="white" opacity="0.55"/>
  <circle cx="64" cy="43" r="1.5" fill="white" opacity="0.55"/>

  ${glassesHTML}

  <!-- NOSE — tiny cute button, barely there -->
  <ellipse cx="50" cy="52" rx="3.5" ry="2.5" fill="${skinSh}" opacity="0.35"/>

  <!-- CHEEKS — big rosy circles, very cartoon -->
  <circle cx="21" cy="52" r="10" fill="rgba(248,120,100,0.3)"/>
  <circle cx="79" cy="52" r="10" fill="rgba(248,120,100,0.3)"/>

  <!-- MOUTH — huge happy smile, clean arc with white teeth -->
  <path d="M30,57 Q50,78 70,57" stroke="${hair}" stroke-width="3.8" fill="none" stroke-linecap="round"/>
  <path d="M32,58.5 Q50,76 68,58.5 Q50,72 32,58.5 Z" fill="white"/>
  <!-- Dimples -->
  <circle cx="30" cy="57" r="3" fill="rgba(210,100,70,0.32)"/>
  <circle cx="70" cy="57" r="3" fill="rgba(210,100,70,0.32)"/>

  ${cigarHTML}
  </svg>`;
}

// ───── COMING SOON TOAST ─────

function showComingSoon(label) {
  const toast = document.getElementById('coming-toast');
  toast.textContent = `${label} — Coming Soon`;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ───── LOBBY RENDERING ─────

function renderLobbySeats() {
  const wrap = document.getElementById('lobby-seats');
  wrap.innerHTML = '';
  SEAT_LOBBY_POS.forEach((pos, i) => {
    const player = state.players.find(p => p.seat === i);
    const div    = document.createElement('div');
    div.className   = 'lobby-seat';
    div.style.left  = pos.left;
    div.style.top   = pos.top;
    if (player) {
      div.innerHTML = `
        <div class="lobby-seat-avatar occupied">${characterSVG(player.color, 42, { glasses: player.glasses, cigar: player.cigar })}</div>
        <div class="lobby-seat-name">${escHtml(player.name)}</div>`;
    } else {
      div.innerHTML = `
        <div class="lobby-seat-avatar">+</div>
        <div class="lobby-seat-name" style="color:rgba(255,255,255,0.1)">Open</div>`;
    }
    wrap.appendChild(div);
  });
}

function renderLobby() {
  renderLobbySeats();
  const count    = state.players.length;
  const status   = document.getElementById('lobby-status');
  const startBtn = document.getElementById('start-btn');
  const joinBtn  = document.getElementById('join-btn');
  if (count >= 5) {
    status.textContent = 'Table is full!';
    joinBtn.disabled = true;
    startBtn.style.display = 'block';
  } else {
    const need = 2 - count;
    status.textContent = count === 0 ? 'Be the first to sit down.'
      : need > 0 ? `${count}/5 seated — need ${need} more to start`
      : `${count}/5 seated — ready to start!`;
    joinBtn.disabled = false;
    startBtn.style.display = count >= 2 ? 'block' : 'none';
  }
}

// ───── GAME RENDERING ─────

function renderGame() {
  renderCharacters();
  renderPot();
  renderBetDisplay();
  renderActions();
  renderPlayerSwitcher();
}

function renderCharacters() {
  const layer = document.getElementById('characters-layer');
  layer.innerHTML = '';

  state.players.forEach(player => {
    const div       = document.createElement('div');
    div.className   = 'seat-char';
    div.dataset.seat = player.seat;
    div.dataset.id   = player.id;

    // Participant data
    const pData   = state.bet ? state.bet.participants.get(player.id) : undefined;
    const pStatus = pData?.status;
    const pPick   = pData?.pick;

    if (state.bet) {
      if (state.bet.creatorId === player.id)                 div.classList.add('creator');
      if (pStatus === 'in' || pStatus === 'allin')            div.classList.add('in-bet');
      if (pStatus === 'out')                                 div.classList.add('passed');
      if (pStatus === 'folded')                              div.classList.add('folded-out');
      if (state.phase === 'BETTING_ROUND' &&
          getActingPlayerId() === player.id)                 div.classList.add('acting-turn');
    }

    // Straight bet RESOLVING: clickable winners
    if (state.phase === 'RESOLVING' && state.bet?.type === 'STRAIGHT' &&
        (pStatus === 'in' || pStatus === 'allin')) {
      div.classList.add('pick-winner');
      div.addEventListener('click', () => finalizeBet([player.id]));
    }

    // O/U pick badge
    let pickBadge = '';
    if (state.bet?.type === 'OVER_UNDER' && (pStatus === 'in' || pStatus === 'allin') && pPick) {
      const isOver = pPick === 'over';
      pickBadge = `<div class="pick-badge ${isOver ? 'pick-over' : 'pick-under'}">${isOver ? '▲ OVER' : '▼ UNDER'}</div>`;
    }

    // Committed chips badge (during poker round)
    const committed = pData?.committed || 0;
    const committedBadge = committed > 0
      ? `<div class="committed-badge">${committed}🪙 in</div>` : '';

    // Fold overlay
    const foldOverlay = pStatus === 'folded'
      ? `<div class="fold-overlay">FOLD</div>` : '';

    const chairBg = `linear-gradient(160deg, #2a1608, #1a0e04)`;

    div.innerHTML = `
      <div class="seat-chair" style="background:${chairBg}"></div>
      <div class="char-svg-wrap" style="position:relative">
        ${characterSVG(player.color, 80, { glasses: player.glasses, cigar: player.cigar })}
        <div class="coin-badge">${player.coins}</div>
        ${committedBadge}
        ${pickBadge}
        ${foldOverlay}
      </div>
      <div class="name-tag">${escHtml(player.name)}</div>`;
    layer.appendChild(div);
  });
}

function renderPot() {
  const coinsEl  = document.getElementById('pot-coins-display');
  const amountEl = document.getElementById('pot-amount');
  if (!state.bet || state.bet.potCoins === 0) {
    coinsEl.innerHTML    = '';
    amountEl.textContent = '';
    return;
  }
  const visual = Math.min(state.bet.potCoins, 30);
  coinsEl.innerHTML = Array.from({ length: visual }, () => `<div class="pot-coin"></div>`).join('');

  if (state.phase === 'BETTING_ROUND') {
    const raises = state.bet.raiseCount;
    amountEl.innerHTML = `${state.bet.potCoins} ${capitalize(state.bet.currency)} in the Pot`
      + `<br><span class="bet-level-info">Current bet: ${state.bet.currentBet}🪙 · ${raises}/3 raises</span>`;
  } else {
    amountEl.textContent = `${state.bet.potCoins} ${capitalize(state.bet.currency)} in the Pot`;
  }
}

function renderBetDisplay() {
  const el   = document.getElementById('bet-topic-display');
  const ouEl = document.getElementById('ou-live');
  if (!state.bet) { el.textContent = ''; ouEl.innerHTML = ''; return; }
  el.textContent = `"${state.bet.topic}"`;
  renderOULive();
}

function renderOULive() {
  const el = document.getElementById('ou-live');
  if (!state.bet || state.bet.type !== 'OVER_UNDER') { el.innerHTML = ''; return; }

  let overCount = 0, underCount = 0;
  state.bet.participants.forEach(d => {
    if (d.status === 'in' || d.status === 'allin') {
      if (d.pick === 'over')  overCount++;
      if (d.pick === 'under') underCount++;
    }
  });
  el.innerHTML = `
    <div class="ou-pill ou-pill-over">▲ OVER&nbsp;${overCount}</div>
    <div class="ou-line">${escHtml(state.bet.line || '')}</div>
    <div class="ou-pill ou-pill-under">▼ UNDER&nbsp;${underCount}</div>`;
}

function renderActions() {
  const zone = document.getElementById('action-zone');
  const ap   = getActivePlayer();
  zone.innerHTML = '';
  if (!ap) return;

  // In turn-based phases, non-active players wait. BET_ACTIVE is simultaneous — no gate.
  const isTurnBased = ['IDLE', 'BETTING_ROUND', 'BET_CLOSED', 'RESOLVING'].includes(state.phase);
  if (roomCode && localPlayerId && isTurnBased && state.activePlayerId !== localPlayerId) {
    zone.innerHTML = `<div class="action-hint">Waiting for ${escHtml(ap.name)}…</div>`;
    return;
  }

  // In BET_ACTIVE multiplayer, each device acts as their own player
  const me = (roomCode && localPlayerId) ? (getPlayer(localPlayerId) || ap) : ap;

  // ── IDLE ──
  if (state.phase === 'IDLE') {
    zone.innerHTML = `
      <button class="btn-gold" id="act-create">+ Create a Bet</button>
      <div class="action-hint">${escHtml(ap.name)} — 🪙 ${ap.coins} coins</div>`;
    document.getElementById('act-create').addEventListener('click', openCreateBet);
    return;
  }

  // ── BET ACTIVE (Classic mode) ──
  if (state.phase === 'BET_ACTIVE' && state.bet) {
    const pData     = state.bet.participants.get(me.id);
    const pStatus   = pData?.status;
    const pPick     = pData?.pick;
    const isCreator = state.bet.creatorId === me.id;

    if (pStatus === undefined) {
      if (state.bet.type === 'OVER_UNDER') {
        zone.innerHTML = `
          <div class="action-hint" style="margin-bottom:4px">Pick your side (${state.bet.units} 🪙):</div>
          <div class="pick-side-row">
            <button class="btn-over"  id="act-over">▲ OVER</button>
            <button class="btn-under" id="act-under">▼ UNDER</button>
          </div>
          <button class="btn-secondary" id="act-pass">Pass</button>`;
        document.getElementById('act-over').addEventListener('click',  () => joinPickSide(me.id, 'over'));
        document.getElementById('act-under').addEventListener('click', () => joinPickSide(me.id, 'under'));
        document.getElementById('act-pass').addEventListener('click',  () => passBet(me.id));
      } else {
        zone.innerHTML = `
          <button class="btn-primary"   id="act-join">Join Bet (${state.bet.units} 🪙)</button>
          <button class="btn-secondary" id="act-pass">Pass</button>`;
        document.getElementById('act-join').addEventListener('click', () => joinBet(me.id));
        document.getElementById('act-pass').addEventListener('click', () => passBet(me.id));
      }
    } else if (pStatus === 'in') {
      if (isCreator) {
        let othersIn = 0;
        state.bet.participants.forEach((d, pid) => { if (d.status === 'in' && pid !== me.id) othersIn++; });
        if (othersIn > 0) {
          zone.innerHTML = `
            <button class="btn-danger" id="act-resolve">Resolve Bet →</button>
            <div class="action-hint">You created this bet.</div>`;
          document.getElementById('act-resolve').addEventListener('click', openResolveBet);
        } else {
          zone.innerHTML = `<div class="action-hint">Waiting for others to join…</div>`;
        }
      } else {
        const pickLabel = pPick === 'over' ? '▲ OVER' : pPick === 'under' ? '▼ UNDER' : '';
        zone.innerHTML = `<div class="action-hint" style="color:#aee8c0">You're in! ${pickLabel} 🪙 ${state.bet.units} wagered.</div>`;
      }
    } else if (pStatus === 'out') {
      zone.innerHTML = `<div class="action-hint">You passed on this one.</div>`;
    }
    return;
  }

  // ── BETTING ROUND (Poker mode) ──
  if (state.phase === 'BETTING_ROUND' && state.bet) {
    const bet      = state.bet;
    const actingId = getActingPlayerId();

    // Not your turn — just show who's up
    if (!actingId || ap.id !== actingId) {
      const name = getPlayer(actingId)?.name || '…';
      zone.innerHTML = `<div class="action-hint poker-waiting">⏳ Waiting for <strong>${escHtml(name)}</strong> to act…</div>`;
      return;
    }

    const pData      = bet.participants.get(actingId);
    const callCost   = Math.max(0, bet.currentBet - (pData?.committed || 0));
    const isCheck    = callCost === 0;
    const canFold    = actingId !== bet.creatorId;
    const canRaise   = bet.raiseCount < 3 && ap.coins > 0;
    const minRaiseTo = bet.currentBet + bet.lastRaiseSize;
    const maxRaiseTo = (pData?.committed || 0) + ap.coins;
    const alreadyPicked = !!pData?.pick;
    const isOu      = bet.type === 'OVER_UNDER';

    if (_raiseAmt < minRaiseTo || _raiseAmt > maxRaiseTo) _raiseAmt = Math.min(minRaiseTo, maxRaiseTo);

    const raiseBlock = canRaise ? `
      <div class="raise-input-row">
        <button class="raise-adj" id="raise-minus">−</button>
        <span class="raise-label">to</span>
        <span class="raise-val" id="raise-display">${_raiseAmt}</span>
        <span class="raise-label">🪙</span>
        <button class="raise-adj" id="raise-plus">+</button>
      </div>` : '';

    if (isOu && !alreadyPicked) {
      // O/U — must pick a side with the call/raise
      const callLabel = isCheck ? 'Check' : `Call ${bet.currentBet}🪙`;
      zone.innerHTML = `
        <div class="action-hint" style="margin-bottom:4px">${callLabel} &amp; pick your side:</div>
        <div class="pick-side-row">
          <button class="btn-over"  id="act-co">▲ OVER</button>
          <button class="btn-under" id="act-cu">▼ UNDER</button>
        </div>
        ${canRaise ? `${raiseBlock}
        <div class="pick-side-row" style="margin-top:4px">
          <button class="btn-raise" id="act-ro">↑ Raise Over</button>
          <button class="btn-raise" id="act-ru">↑ Raise Under</button>
        </div>` : ''}
        ${canFold ? `<button class="btn-fold" id="act-fold">✗ Fold</button>` : ''}
        <div class="action-hint">${escHtml(ap.name)} · ${ap.coins}🪙 left · Pot: ${bet.potCoins}🪙</div>`;
      document.getElementById('act-co')?.addEventListener('click', () => pokerCall('over'));
      document.getElementById('act-cu')?.addEventListener('click', () => pokerCall('under'));
      document.getElementById('act-ro')?.addEventListener('click', () => pokerRaise(_raiseAmt, 'over'));
      document.getElementById('act-ru')?.addEventListener('click', () => pokerRaise(_raiseAmt, 'under'));
    } else {
      const sideTag  = alreadyPicked ? ` (${pData.pick === 'over' ? '▲' : '▼'})` : '';
      const callBtn  = isCheck
        ? `<button class="btn-check" id="act-check">✓ Check${sideTag}</button>`
        : `<button class="btn-call"  id="act-call">= Call ${bet.currentBet}🪙${sideTag} <span class="call-cost">(+${callCost})</span></button>`;
      zone.innerHTML = `
        ${callBtn}
        ${canRaise ? `${raiseBlock}
        <button class="btn-raise" id="act-raise">↑ Raise${sideTag}</button>` : ''}
        ${canFold ? `<button class="btn-fold" id="act-fold">✗ Fold</button>` : ''}
        <div class="action-hint">${escHtml(ap.name)} · ${ap.coins}🪙 left · Pot: ${bet.potCoins}🪙</div>`;
      document.getElementById('act-check')?.addEventListener('click', () => pokerCall(pData?.pick || null));
      document.getElementById('act-call')?.addEventListener('click',  () => pokerCall(pData?.pick || null));
      document.getElementById('act-raise')?.addEventListener('click', () => pokerRaise(_raiseAmt, pData?.pick || null));
    }

    // Shared raise adj + fold
    document.getElementById('raise-minus')?.addEventListener('click', () => {
      _raiseAmt = Math.max(minRaiseTo, _raiseAmt - bet.lastRaiseSize);
      syncRaiseDisplay();
    });
    document.getElementById('raise-plus')?.addEventListener('click', () => {
      _raiseAmt = Math.min(maxRaiseTo, _raiseAmt + bet.lastRaiseSize);
      syncRaiseDisplay();
    });
    document.getElementById('act-fold')?.addEventListener('click', pokerFold);
    return;
  }

  // ── BET CLOSED — waiting for real-world event ──
  if (state.phase === 'BET_CLOSED' && state.bet) {
    const isCreator = ap.id === state.bet.creatorId;
    if (isCreator) {
      zone.innerHTML = `
        <button class="btn-danger" id="act-resolve">Resolve Bet →</button>
        <div class="action-hint">Pot locked: ${state.bet.potCoins}🪙 · Declare the winner.</div>`;
      document.getElementById('act-resolve').addEventListener('click', openResolveBet);
    } else {
      const creatorName = getPlayer(state.bet.creatorId)?.name || 'the creator';
      zone.innerHTML = `<div class="action-hint poker-waiting">🔒 Pot locked at ${state.bet.potCoins}🪙 — waiting for <strong>${escHtml(creatorName)}</strong> to resolve.</div>`;
    }
    return;
  }

  // ── RESOLVING ──
  if (state.phase === 'RESOLVING' && state.bet) {
    const isCreator = ap.id === state.bet.creatorId;
    const pData     = state.bet.participants.get(ap.id);
    if (isCreator) {
      zone.innerHTML = `
        <button class="btn-danger" id="act-resolve">Pick Winner</button>
        <div class="action-hint">Click a player or use the button.</div>`;
      document.getElementById('act-resolve').addEventListener('click', openResolveBet);
    } else if (pData?.status === 'in' || pData?.status === 'allin') {
      const pickLabel = pData.pick === 'over' ? '▲ OVER' : pData.pick === 'under' ? '▼ UNDER' : '';
      zone.innerHTML = `<div class="action-hint" style="color:#aee8c0">You're in${pickLabel ? ' · ' + pickLabel : ''} · Waiting on resolution.</div>`;
    } else {
      zone.innerHTML = `<div class="action-hint">You folded this round.</div>`;
    }
  }
}

function renderPlayerSwitcher() {
  const sel = document.getElementById('active-select');
  if (roomCode && localPlayerId) {
    const me = state.players.find(p => p.id === localPlayerId);
    sel.innerHTML = me ? `<option>${escHtml(me.name)} 🪙${me.coins}</option>` : '';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.innerHTML = state.players
      .map(p => `<option value="${p.id}" ${p.id === state.activePlayerId ? 'selected' : ''}>${escHtml(p.name)} 🪙${p.coins}</option>`)
      .join('');
  }
}

function renderLog() {
  const el = document.getElementById('game-log');
  el.innerHTML = state.log.map(m => `<div class="log-entry">${m}</div>`).join('');
}

// ───── LEADERBOARD ─────

function renderLeaderboard() {
  const list = document.getElementById('lb-list');
  if (!state.players.length) {
    list.innerHTML = '<div class="lb-empty">No players yet</div>';
    return;
  }
  const sorted  = [...state.players].sort((a, b) => {
    const wD = (b.wins || 0) - (a.wins || 0);
    return wD !== 0 ? wD : (b.allTimeEarned || 0) - (a.allTimeEarned || 0);
  });
  const lastIdx = sorted.length - 1;

  list.innerHTML = sorted.map((p, i) => {
    let medalClass = '', rankDisplay = `${i + 1}`;
    if (i === 0)                            { medalClass = 'medal-gold';   rankDisplay = '🥇'; }
    else if (i === 1)                       { medalClass = 'medal-bronze'; rankDisplay = '🥉'; }
    else if (i === lastIdx && lastIdx >= 2) { medalClass = 'medal-silver'; rankDisplay = '🥈'; }

    const wins       = p.wins || 0;
    const played     = p.betsPlayed || 0;
    const winRate    = played > 0 ? Math.round((wins / played) * 100) : 0;
    const bestStreak = p.bestStreak || 0;

    return `
      <div class="lb-row ${medalClass}">
        <div class="lb-row-top">
          <div class="lb-rank">${rankDisplay}</div>
          <div class="lb-avatar" style="background:${p.color}"></div>
          <div class="lb-name">${escHtml(p.name)}</div>
          <div class="lb-coins-cur">${p.coins} 🪙</div>
        </div>
        <div class="lb-stats-strip">
          <div class="lb-stat-block">
            <div class="lb-sv">${wins}</div>
            <div class="lb-sl">Wins</div>
          </div>
          <div class="lb-stat-divider"></div>
          <div class="lb-stat-block">
            <div class="lb-sv">${winRate}%</div>
            <div class="lb-sl">Win Rate</div>
          </div>
          <div class="lb-stat-divider"></div>
          <div class="lb-stat-block">
            <div class="lb-sv">${bestStreak}</div>
            <div class="lb-sl">Best Streak</div>
          </div>
          <div class="lb-stat-divider"></div>
          <div class="lb-stat-block">
            <div class="lb-sv">${p.allTimeEarned || 0}</div>
            <div class="lb-sl">All-Time</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

function toggleLeaderboard() {
  const panel    = document.getElementById('lb-panel');
  const backdrop = document.getElementById('lb-backdrop');
  const hidden   = panel.classList.contains('lb-hidden');
  panel.classList.toggle('lb-hidden',    !hidden);
  backdrop.classList.toggle('lb-hidden', !hidden);
  if (hidden) renderLeaderboard();
}

// ───── MODAL ─────

function showModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}
function hideModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ───── LOBBY ACTIONS ─────

let selectedColor = SHIRT_COLORS[0].hex;

function initColorPicker() {
  const picker = document.getElementById('color-picker');
  picker.innerHTML = '';
  SHIRT_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    sw.style.background = c.hex;
    sw.title = c.name;
    sw.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = c.hex;
    });
    picker.appendChild(sw);
  });
}

function joinLobby() {
  const nameEl  = document.getElementById('name-input');
  const name    = nameEl.value.trim();
  if (!name) {
    nameEl.focus();
    nameEl.style.borderColor = 'rgba(200,50,50,0.6)';
    setTimeout(() => nameEl.style.borderColor = '', 700);
    return;
  }
  if (state.players.length >= 5) return;

  const taken = state.players.map(p => p.color);
  let color   = selectedColor;
  if (taken.includes(color)) {
    const fb = SHIRT_COLORS.find(c => !taken.includes(c.hex));
    if (fb) color = fb.hex;
  }
  const glasses = document.getElementById('acc-glasses').classList.contains('active');
  const cigar   = document.getElementById('acc-cigar').classList.contains('active');

  const newPlayer = {
    id: uid(), name, color, coins: 20, seat: state.players.length,
    allTimeEarned: 0, glasses, cigar,
    wins: 0, betsPlayed: 0, currentStreak: 0, bestStreak: 0,
  };
  if (roomCode) {
    localPlayerId = newPlayer.id;
    sessionStorage.setItem('freebet_player', newPlayer.id);
  }
  state.players.push(newPlayer);

  nameEl.value = '';
  document.getElementById('acc-glasses').classList.remove('active');
  document.getElementById('acc-cigar').classList.remove('active');
  SFX.sitDown();
  renderLobby();
  pushState();
}

function startGame() {
  if (state.players.length < 2) return;
  state.phase = 'IDLE';
  state.activePlayerId = state.players[0].id;
  document.getElementById('lobby').classList.remove('active');
  document.getElementById('game').classList.add('active');
  SFX.gameStart();
  renderGame();
  addLog(`<span class="log-name">FreeBet started</span> — ${state.players.length} players at the table. Let's go!`);
  pushState();
}

// ───── BET CREATION ─────

function openCreateBet() {
  const ap = getActivePlayer();
  if (!ap) return;

  showModal(`
    <h2>Create a Bet</h2>
    <p class="subtitle">Set the terms. Everyone wagers the same.</p>
    <div class="bet-type-toggle">
      <button class="bet-type-btn active" data-type="STRAIGHT">Straight Bet</button>
      <button class="bet-type-btn" data-type="OVER_UNDER">Over / Under</button>
    </div>
    <div class="bet-style-toggle">
      <button class="bet-style-btn active" data-style="classic">Classic</button>
      <button class="bet-style-btn" data-style="poker">🃏 Poker Round</button>
    </div>
    <div class="form-field">
      <label>What are you betting on?</label>
      <textarea id="bet-topic" rows="2" placeholder="Lakers win tonight, I'll finish in 30 mins…" maxlength="120"></textarea>
    </div>
    <div id="ou-fields" style="display:none">
      <div class="form-field">
        <label>Set the Line</label>
        <input type="text" id="bet-line" placeholder="e.g. 107.5 points, 3 touchdowns…" maxlength="40">
      </div>
      <div class="form-field">
        <label>Your Pick</label>
        <div class="pick-side-row">
          <button type="button" class="btn-over  side-btn" data-pick="over">▲ OVER</button>
          <button type="button" class="btn-under side-btn" data-pick="under">▼ UNDER</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Currency</label>
        <input type="text" id="bet-currency" placeholder="beers, push-ups, dollars…" maxlength="30">
      </div>
      <div class="form-field" style="max-width:90px">
        <label>Units each</label>
        <input type="number" id="bet-units" value="1" min="1" max="10">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="bet-cancel">Cancel</button>
      <button class="btn-gold"      id="bet-submit">Create Bet</button>
    </div>`);

  // Toggle straight / O/U
  document.querySelectorAll('.bet-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bet-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ou-fields').style.display =
        btn.dataset.type === 'OVER_UNDER' ? 'block' : 'none';
    });
  });

  // Betting style toggle
  document.querySelectorAll('.bet-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bet-style-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Side buttons
  document.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      btn.style.borderWidth = '2px';
    });
  });

  document.getElementById('bet-cancel').addEventListener('click', hideModal);
  document.getElementById('bet-submit').addEventListener('click', submitCreateBet);
  document.getElementById('bet-topic').focus();
}

function submitCreateBet() {
  const betType  = document.querySelector('.bet-type-btn.active')?.dataset.type || 'STRAIGHT';
  const topic    = document.getElementById('bet-topic').value.trim();
  const currency = document.getElementById('bet-currency').value.trim();
  const units    = Math.max(1, Math.min(10, parseInt(document.getElementById('bet-units').value) || 1));
  const ap       = getActivePlayer();

  if (!topic || !currency || !ap) return;

  let creatorPick = null;
  let line        = null;

  if (betType === 'OVER_UNDER') {
    line = document.getElementById('bet-line')?.value.trim();
    if (!line) {
      const el = document.getElementById('bet-line');
      if (el) { el.style.borderColor = 'rgba(200,50,50,0.6)'; setTimeout(() => el.style.borderColor = '', 700); }
      return;
    }
    creatorPick = document.querySelector('.side-btn.selected')?.dataset.pick;
    if (!creatorPick) {
      addLog('Please pick your side (OVER or UNDER) before creating an O/U bet.');
      return;
    }
  }

  if (ap.coins < units) {
    const el = document.getElementById('bet-units');
    if (el) { el.style.borderColor = 'rgba(200,50,50,0.6)'; setTimeout(() => el.style.borderColor = '', 700); }
    return;
  }

  const pokerMode = document.querySelector('.bet-style-btn.active')?.dataset.style === 'poker';

  ap.coins -= units;

  const typeLabel = betType === 'OVER_UNDER' ? 'Over/Under' : 'Straight';
  const lineInfo  = line ? ` · Line: <strong>${escHtml(line)}</strong>` : '';

  if (!pokerMode) {
    // ── CLASSIC MODE ──
    const participants = new Map();
    participants.set(ap.id, { status: 'in', pick: creatorPick });

    state.bet = {
      id: uid(), type: betType, topic, line, currency, units,
      creatorId: ap.id, participants, potCoins: units, pokerMode: false,
    };
    state.phase = 'BET_ACTIVE';

    hideModal();
    SFX.betCreated();
    addLog(`<span class="log-name">${escHtml(ap.name)}</span> opened a ${typeLabel} bet: <em>"${escHtml(topic)}"</em>${lineInfo}`);
    addLog(`Wagering <span class="log-gold">${units} ${escHtml(currency)}</span> each.`);
    renderGame();
    animateCoinsToCenter(ap.id, units);
    pushState();

  } else {
    // ── POKER MODE ──
    const participants = new Map();
    participants.set(ap.id, {
      status: 'in', pick: creatorPick, committed: units, hasActedThisRound: false,
    });
    state.players.forEach(p => {
      if (p.id !== ap.id)
        participants.set(p.id, { status: 'pending', pick: null, committed: 0, hasActedThisRound: false });
    });

    const actingOrder = buildActingOrder(ap.id);

    state.bet = {
      id: uid(), type: betType, topic, line, currency, units,
      creatorId: ap.id, participants, potCoins: units, pokerMode: true,
      currentBet: units, lastRaiseSize: units,
      actingOrder, actionIdx: 0, raiseCount: 0, roundComplete: false,
    };

    state.phase          = 'BETTING_ROUND';
    state.activePlayerId = actingOrder[0];
    _raiseAmt            = units * 2;

    hideModal();
    SFX.betCreated();
    addLog(`<span class="log-name">${escHtml(ap.name)}</span> opens a ${typeLabel} bet: <em>"${escHtml(topic)}"</em>${lineInfo}`);
    addLog(`🃏 Poker round — opening bet: <span class="log-gold">${units} ${escHtml(currency)}</span>. ${escHtml(getPlayer(actingOrder[0])?.name || '')} acts first.`);
    renderGame();
    animateCoinsToCenter(ap.id, units);
    pushState();
  }
}

// ───── JOIN BET ─────

function joinBet(playerId) {
  const player = getPlayer(playerId);
  if (!player || !state.bet) return;
  if (state.bet.participants.has(playerId)) return;
  if (player.coins < state.bet.units) {
    addLog(`<span class="log-name">${escHtml(player.name)}</span> doesn't have enough coins!`);
    return;
  }
  player.coins -= state.bet.units;
  state.bet.participants.set(playerId, { status: 'in', pick: null });
  state.bet.potCoins += state.bet.units;
  addLog(`<span class="log-name">${escHtml(player.name)}</span> joined the bet — <span class="log-gold">${state.bet.potCoins} ${escHtml(state.bet.currency)} in the pot</span>`);
  SFX.joinBet();
  renderGame();
  animateCoinsToCenter(playerId, state.bet.units);
  pushState();
}

function joinPickSide(playerId, pick) {
  const player = getPlayer(playerId);
  if (!player || !state.bet) return;
  if (state.bet.participants.has(playerId)) return;
  if (player.coins < state.bet.units) {
    addLog(`<span class="log-name">${escHtml(player.name)}</span> doesn't have enough coins!`);
    return;
  }
  player.coins -= state.bet.units;
  state.bet.participants.set(playerId, { status: 'in', pick });
  state.bet.potCoins += state.bet.units;
  const label = pick === 'over' ? '▲ OVER' : '▼ UNDER';
  addLog(`<span class="log-name">${escHtml(player.name)}</span> picked <strong>${label}</strong> — <span class="log-gold">${state.bet.potCoins} ${escHtml(state.bet.currency)} in the pot</span>`);
  if (pick === 'over') SFX.pickOver(); else SFX.pickUnder();
  renderGame();
  animateCoinsToCenter(playerId, state.bet.units);
  pushState();
}

function passBet(playerId) {
  const player = getPlayer(playerId);
  if (!player || !state.bet) return;
  state.bet.participants.set(playerId, { status: 'out', pick: null });
  addLog(`<span class="log-name">${escHtml(player.name)}</span> passed.`);
  SFX.pass();
  renderGame();
  pushState();
}

// ───── POKER BETTING ROUND ─────

function buildActingOrder(creatorId) {
  const sorted     = [...state.players].sort((a, b) => a.seat - b.seat);
  const creatorIdx = sorted.findIndex(p => p.id === creatorId);
  const order      = [];
  for (let i = 1; i < sorted.length; i++) {
    order.push(sorted[(creatorIdx + i) % sorted.length].id);
  }
  order.push(creatorId); // creator acts last
  return order;
}

function getActingPlayerId() {
  if (!state.bet || state.phase !== 'BETTING_ROUND') return null;
  return state.bet.actingOrder[state.bet.actionIdx];
}

function countActivePlayers() {
  let n = 0;
  state.bet.participants.forEach(d => { if (d.status === 'in' || d.status === 'allin') n++; });
  return n;
}

function getLastActivePlayerId() {
  let id = null;
  state.bet.participants.forEach((d, pid) => { if (d.status === 'in' || d.status === 'allin') id = pid; });
  return id;
}

function isRoundComplete() {
  const bet    = state.bet;
  let   active = 0, allMatched = true, allActed = true;
  bet.participants.forEach(d => {
    if (d.status === 'folded' || d.status === 'pending') return;
    active++;
    if (d.status === 'allin') return; // can't act further, ignore for match check
    if (d.committed < bet.currentBet) allMatched = false;
    if (!d.hasActedThisRound)          allActed   = false;
  });
  if (active <= 1) return true;
  return allMatched && allActed;
}

function syncRaiseDisplay() {
  const el = document.getElementById('raise-display');
  if (el) el.textContent = _raiseAmt;
}

function advanceAction() {
  const bet = state.bet;
  let steps = 0;
  do {
    bet.actionIdx = (bet.actionIdx + 1) % bet.actingOrder.length;
    steps++;
    if (steps > bet.actingOrder.length) break;
  } while (['folded', 'allin'].includes(
    bet.participants.get(bet.actingOrder[bet.actionIdx])?.status
  ));

  if (isRoundComplete()) { closeBettingRound(); return; }

  state.activePlayerId = bet.actingOrder[bet.actionIdx];
  renderGame();
  renderPlayerSwitcher();
  pushState();
}

function pokerFold() {
  const bet      = state.bet;
  const actingId = getActingPlayerId();
  if (!bet || !actingId || actingId === bet.creatorId) return; // creator can't fold
  const pData  = bet.participants.get(actingId);
  const player = getPlayer(actingId);
  pData.status            = 'folded';
  pData.hasActedThisRound = true;
  addLog(`<span class="log-name">${escHtml(player.name)}</span> folded.`);
  SFX.pass();
  if (countActivePlayers() === 1) {
    handleLastPlayerStanding(getLastActivePlayerId());
    return;
  }
  advanceAction();
}

function pokerCall(pick = null) {
  const bet      = state.bet;
  const actingId = getActingPlayerId();
  if (!bet || !actingId) return;
  const pData  = bet.participants.get(actingId);
  const player = getPlayer(actingId);
  if (pick && !pData.pick) pData.pick = pick;

  const cost       = Math.max(0, bet.currentBet - pData.committed);
  const actualCost = Math.min(cost, player.coins);

  if (cost === 0) {
    pData.hasActedThisRound = true;
    addLog(`<span class="log-name">${escHtml(player.name)}</span> checked.`);
  } else {
    player.coins   -= actualCost;
    pData.committed += actualCost;
    bet.potCoins   += actualCost;
    pData.status            = player.coins === 0 ? 'allin' : 'in';
    pData.hasActedThisRound = true;
    if (pData.status === 'allin') {
      addLog(`<span class="log-name">${escHtml(player.name)}</span> is <strong>ALL IN</strong> for <span class="log-gold">${pData.committed} 🪙</span>!`);
    } else {
      addLog(`<span class="log-name">${escHtml(player.name)}</span> called <span class="log-gold">${bet.currentBet} ${escHtml(bet.currency)}</span>.`);
    }
    animateCoinsToCenter(actingId, actualCost);
  }
  SFX.joinBet();
  if (isRoundComplete()) { renderGame(); closeBettingRound(); return; }
  advanceAction();
}

function pokerRaise(raiseTo, pick = null) {
  const bet      = state.bet;
  const actingId = getActingPlayerId();
  if (!bet || !actingId) return;
  const pData    = bet.participants.get(actingId);
  const player   = getPlayer(actingId);
  if (bet.raiseCount >= 3) { addLog('Raise cap reached (3 raises).'); return; }

  const minRaiseTo = bet.currentBet + bet.lastRaiseSize;
  raiseTo          = Math.max(minRaiseTo, Math.min(raiseTo, pData.committed + player.coins));

  if (pick && !pData.pick) pData.pick = pick;

  const cost      = raiseTo - pData.committed;
  const raiseSize = raiseTo - bet.currentBet;

  player.coins    -= cost;
  pData.committed  = raiseTo;
  bet.potCoins    += cost;
  bet.lastRaiseSize = raiseSize;
  bet.currentBet   = raiseTo;
  bet.raiseCount++;
  pData.status            = player.coins === 0 ? 'allin' : 'in';
  pData.hasActedThisRound = true;

  // Everyone else must re-act
  bet.participants.forEach((d, pid) => {
    if (pid !== actingId && d.status === 'in') d.hasActedThisRound = false;
  });

  addLog(`<span class="log-name">${escHtml(player.name)}</span> raised to <span class="log-gold">${raiseTo} ${escHtml(bet.currency)}</span>! (${bet.raiseCount}/3 raises)`);
  SFX.betCreated();
  animateCoinsToCenter(actingId, cost);

  // Reset raise UI for next player
  _raiseAmt = Math.min(bet.currentBet + bet.lastRaiseSize, pData.committed + player.coins);

  advanceAction();
}

function closeBettingRound() {
  state.phase = 'BET_CLOSED';
  state.bet.roundComplete = true;
  state.activePlayerId    = state.bet.creatorId;
  addLog(`🃏 Betting closed — pot: <span class="log-gold">${state.bet.potCoins} ${escHtml(state.bet.currency)}</span>. Waiting on the outcome…`);
  SFX.drumRoll();
  renderGame();
  renderPlayerSwitcher();
  pushState();
}

function handleLastPlayerStanding(winnerId) {
  const winner = getPlayer(winnerId);
  const bet    = state.bet;
  winner.coins        += bet.potCoins;
  winner.allTimeEarned = (winner.allTimeEarned || 0) + bet.potCoins;
  winner.wins          = (winner.wins || 0) + 1;
  winner.currentStreak = (winner.currentStreak || 0) + 1;
  winner.bestStreak    = Math.max(winner.bestStreak || 0, winner.currentStreak);
  bet.participants.forEach((d, pid) => {
    if (d.committed > 0 && pid !== winnerId) {
      const p = getPlayer(pid);
      if (p) { p.betsPlayed = (p.betsPlayed || 0) + 1; p.currentStreak = 0; }
    }
  });
  winner.betsPlayed = (winner.betsPlayed || 0) + 1;
  addLog(`🃏 Everyone folded — <span class="log-name">${escHtml(winner.name)}</span> takes the pot of <span class="log-gold">${bet.potCoins} ${escHtml(bet.currency)}</span>!`);
  showWinnerOverlay([winner], bet, bet.potCoins);
  pushState();
  setTimeout(() => SFX.fanfare(), 250);
  setTimeout(() => {
    SFX.coinsToWinner(Math.min(bet.potCoins, 12));
    animateCoinsFromCenter(winnerId, Math.min(bet.potCoins, 8));
  }, 500);
}

// ───── RESOLVE BET ─────

function openResolveBet() {
  const ap  = getActivePlayer();
  const bet = state.bet;
  if (!ap || !bet || ap.id !== bet.creatorId) return;

  const inPlayers = [];
  bet.participants.forEach((d, pid) => {
    if (d.status === 'in' || d.status === 'allin') inPlayers.push(getPlayer(pid));
  });

  if (inPlayers.length < 2) {
    addLog('Need at least 2 players still in to resolve.');
    return;
  }

  state.phase = 'RESOLVING';
  SFX.drumRoll();
  renderGame();
  pushState();

  if (bet.type === 'OVER_UNDER') {
    showModal(`
      <h2>Resolve Over/Under</h2>
      <div class="bet-summary-box">
        <div class="bet-topic-lg">"${escHtml(bet.topic)}"</div>
        <div class="bet-currency-lg">Line: ${escHtml(bet.line || '')} · Pot: ${bet.potCoins} ${capitalize(bet.currency)}</div>
      </div>
      <p class="subtitle">Which side won?</p>
      <div class="ou-resolve-btns">
        <button class="btn-over"  id="res-over">▲ Over Won</button>
        <button class="btn-under" id="res-under">▼ Under Won</button>
      </div>
      <button class="btn-secondary" id="res-cancel">Cancel</button>`);

    document.getElementById('res-over').addEventListener('click',   () => resolveOUBet('over'));
    document.getElementById('res-under').addEventListener('click',  () => resolveOUBet('under'));
    document.getElementById('res-cancel').addEventListener('click', cancelResolve);

  } else {
    const options = inPlayers.map(p => `
      <div class="winner-option" data-id="${p.id}">
        <div class="wo-color" style="background:${p.color}"></div>
        <div class="wo-name">${escHtml(p.name)}</div>
        <div class="wo-coins">+${bet.potCoins} 🪙</div>
      </div>`).join('');

    showModal(`
      <h2>Who Won?</h2>
      <div class="bet-summary-box">
        <div class="bet-topic-lg">"${escHtml(bet.topic)}"</div>
        <div class="bet-currency-lg">Pot: ${bet.potCoins} ${capitalize(bet.currency)}</div>
      </div>
      <p class="subtitle">Select the winner — they get the whole pot.</p>
      <div class="winner-options">${options}</div>
      <button class="btn-secondary" id="res-cancel">Cancel</button>`);

    document.querySelectorAll('.winner-option').forEach(el => {
      el.addEventListener('click', () => finalizeBet([el.dataset.id]));
    });
    document.getElementById('res-cancel').addEventListener('click', cancelResolve);
  }
}

function cancelResolve() {
  state.phase = state.bet?.pokerMode ? 'BET_CLOSED' : 'BET_ACTIVE';
  hideModal();
  renderGame();
  pushState();
}

function resolveOUBet(winningSide) {
  const bet = state.bet;
  if (!bet) return;

  const winnerIds = [];
  bet.participants.forEach((d, pid) => {
    if ((d.status === 'in' || d.status === 'allin') && d.pick === winningSide) winnerIds.push(pid);
  });

  if (winnerIds.length === 0) {
    addLog(`No players bet on ${winningSide.toUpperCase()}. Refunding everyone.`);
    bet.participants.forEach((d, pid) => {
      if (d.status === 'in' || d.status === 'allin') {
        const p = getPlayer(pid); if (p) p.coins += d.committed;
      }
    });
    hideModal();
    state.bet   = null;
    state.phase = 'IDLE';
    renderGame();
    return;
  }

  hideModal();
  finalizeBet(winnerIds);
}

// ───── FINALIZE BET (core resolution) ─────

function finalizeBet(winnerIds) {
  const winners = winnerIds.map(id => getPlayer(id)).filter(Boolean);
  const bet     = state.bet;
  if (!winners.length || !bet) return;

  const total     = bet.potCoins;
  const perWinner = Math.floor(total / winners.length);

  winners.forEach(w => {
    w.coins         += perWinner;
    w.allTimeEarned  = (w.allTimeEarned || 0) + perWinner;
  });

  // Track stats — everyone who committed chips gets a betsPlayed count
  const winnerSet = new Set(winnerIds);
  state.bet.participants.forEach((d, pid) => {
    if (d.status === 'pending') return; // never acted
    const p = getPlayer(pid);
    if (!p) return;
    p.betsPlayed = (p.betsPlayed || 0) + 1;
    if (winnerSet.has(pid)) {
      p.wins = (p.wins || 0) + 1;
      p.currentStreak = (p.currentStreak || 0) + 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.currentStreak);
    } else {
      p.currentStreak = 0;
    }
  });

  // Plain-text log
  const nameList = winners.map(w => w.name).join(' & ');
  addLog(`🏆 <span class="log-name">${escHtml(nameList)}</span> won +<span class="log-gold">${perWinner} ${escHtml(bet.currency)}</span> each!`);

  hideModal();
  pushState();

  // Show winner overlay (state.bet kept alive until dismissed)
  showWinnerOverlay(winners, bet, perWinner);

  // Fanfare fires with the overlay appearance
  setTimeout(() => SFX.fanfare(), 250);

  // Coins fly to winners + coin shower sound
  setTimeout(() => {
    SFX.coinsToWinner(Math.min(perWinner, 12));
    winners.forEach((w, i) => {
      setTimeout(() => animateCoinsFromCenter(w.id, Math.min(perWinner, 8)), i * 280);
    });
  }, 500);
}

// ───── OWE TEXT ─────

function boldNames(players) {
  if (!players.length) return '';
  const names = players.map(p => `<strong>${escHtml(p.name)}</strong>`);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(', ') + ` &amp; ${names[names.length - 1]}`;
}

function generateOweText(winners, bet, perWinner) {
  const qty  = bet.units;
  const curr = escHtml(bet.currency);

  // Find losers: participants who were in/allin but didn't win
  const winnerSet = new Set(winners.map(w => w.id));
  const losers = [];
  bet.participants.forEach((d, pid) => {
    if ((d.status === 'in' || d.status === 'allin') && !winnerSet.has(pid)) {
      const p = getPlayer(pid);
      if (p) losers.push(p);
    }
  });

  const wNames = boldNames(winners);
  const lNames = boldNames(losers);

  if (winners.length === 1) {
    if (losers.length === 0) return `${wNames} wins the pot!`;
    const verb = losers.length === 1 ? 'owes' : 'each owe';
    return `${lNames} ${verb} ${wNames} ${qty} ${curr}!`;
  }

  // Multiple winners split the pot
  if (losers.length === 0) {
    return `${wNames} split the pot — ${perWinner} ${curr} each!`;
  }
  const lVerb = losers.length === 1 ? 'owes' : 'each owe';
  return `${lNames} ${lVerb} ${wNames} ${qty} ${curr} each!`;
}

// ───── WINNER OVERLAY ─────

function showWinnerOverlay(winners, bet, perWinner) {
  const overlay  = document.getElementById('winner-overlay');
  const namesEl  = document.getElementById('winner-names');
  const oweEl    = document.getElementById('winner-owe');
  const coinsEl  = document.getElementById('winner-coins-earned');

  namesEl.textContent  = winners.map(w => w.name).join(' & ');
  oweEl.innerHTML      = generateOweText(winners, bet, perWinner);
  coinsEl.textContent  = `+${perWinner} 🪙 ${winners.length > 1 ? 'each' : ''}`;

  createWinnerParticles();

  overlay.classList.remove('wo-hidden');
  overlay.classList.add('wo-visible');
  SFX.modalOpen();

  // Add winner visual to characters
  renderGame(); // re-render without bet cleared yet
  winners.forEach(w => {
    const charEl = document.querySelector(`.seat-char[data-id="${w.id}"]`);
    if (!charEl) return;
    charEl.classList.add('winner');
    const wrap = charEl.querySelector('.char-svg-wrap');
    if (wrap && !wrap.querySelector('.trophy-crown')) {
      const crown       = document.createElement('div');
      crown.className   = 'trophy-crown';
      crown.textContent = '🏆';
      wrap.appendChild(crown);
    }
  });
}

function dismissWinnerOverlay() {
  const overlay = document.getElementById('winner-overlay');
  overlay.classList.add('wo-hidden');
  overlay.classList.remove('wo-visible');

  // Clear winner visuals
  document.querySelectorAll('.seat-char.winner').forEach(el => {
    el.classList.remove('winner');
    const crown = el.querySelector('.trophy-crown');
    if (crown) crown.remove();
  });

  state.bet   = null;
  state.phase = 'IDLE';
  SFX.dismiss();
  renderGame();
  renderLeaderboard();
  pushState();
}

function createWinnerParticles() {
  const container = document.getElementById('winner-particles');
  container.innerHTML = '';
  const colors = ['#f0c040', '#fde88a', '#c8960c', '#ff8c42', '#4ecdc4', '#fff', '#ff6b9d'];

  for (let i = 0; i < 70; i++) {
    const p     = document.createElement('div');
    p.className = 'wo-particle';
    const angle = Math.random() * Math.PI * 2;
    const dist  = 100 + Math.random() * 280;
    const px    = Math.cos(angle) * dist;
    const py    = Math.sin(angle) * dist;
    const size  = 4 + Math.random() * 9;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const delay = Math.random() * 0.5;
    const dur   = 0.9 + Math.random() * 0.7;

    p.style.cssText = `
      width:${size}px; height:${size}px; background:${color};
      border-radius:${Math.random() > 0.4 ? '50%' : '2px'};
      --px:${px}px; --py:${py}px; --delay:${delay}s; --dur:${dur}s;`;
    container.appendChild(p);
  }
}

// ───── COIN ANIMATIONS ─────

function getElCenter(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function getPotCenter() {
  const el = document.getElementById('pot-zone');
  return el ? getElCenter(el) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
function getCharCenter(playerId) {
  const el = document.querySelector(`.seat-char[data-id="${playerId}"]`);
  return el ? getElCenter(el) : getPotCenter();
}
function animateCoinsToCenter(playerId, count) {
  launchCoins(getCharCenter(playerId), getPotCenter(), Math.min(count, 7));
}
function animateCoinsFromCenter(playerId, count) {
  launchCoins(getPotCenter(), getCharCenter(playerId), Math.min(count, 10));
}
function launchCoins(from, to, count) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const coin     = document.createElement('div');
      coin.className = 'flying-coin';
      const jitterX  = (Math.random() - 0.5) * 24;
      const jitterY  = (Math.random() - 0.5) * 24;
      const dx       = to.x - from.x + jitterX;
      const dy       = to.y - from.y + jitterY;
      const dur      = 0.55 + Math.random() * 0.2;
      coin.style.cssText = `left:${from.x - 9}px; top:${from.y - 9}px; --fly-x:${dx}px; --fly-y:${dy}px; --dur:${dur}s;`;
      document.body.appendChild(coin);
      setTimeout(() => coin.remove(), dur * 1000 + 150);
    }, i * 85);
  }
}

// ───── INIT ─────

function init() {
  initRoomEntry();
  initColorPicker();
  renderLobby();

  document.getElementById('join-btn').addEventListener('click', joinLobby);
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('winner-continue').addEventListener('click', dismissWinnerOverlay);
  document.getElementById('lb-btn').addEventListener('click', toggleLeaderboard);
  document.getElementById('lb-close').addEventListener('click', toggleLeaderboard);
  document.getElementById('lb-backdrop').addEventListener('click', toggleLeaderboard);

  document.getElementById('name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinLobby();
  });
  document.getElementById('active-select').addEventListener('change', e => {
    state.activePlayerId = e.target.value;
    renderActions();
    renderPlayerSwitcher();
  });
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) hideModal();
  });

  // ── Global button click sound ──
  // Fires for every button press; specific sounds layer on top as needed
  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (btn && btn.id !== 'mute-btn') SFX.click();
  });

  // Color swatch picks
  document.addEventListener('click', e => {
    if (e.target.classList.contains('color-swatch')) SFX.colorPick();
  });

  // Landing page nav / footer buttons (coming soon)
  [
    ['nav-how',       'How to Play'],
    ['nav-about',     'About FreeBet'],
    ['nav-login',     'Log In'],
    ['nav-signup',    'Sign Up'],
    ['footer-terms',  'Terms of Service'],
    ['footer-privacy','Privacy Policy'],
    ['footer-discord','Discord'],
    ['footer-support','Support'],
  ].forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => showComingSoon(label));
  });

  // Accessory toggles
  ['acc-glasses', 'acc-cigar'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      document.getElementById(id).classList.toggle('active');
    });
  });

  // ── Mute toggle ──
  document.getElementById('mute-btn').addEventListener('click', () => {
    const isMuted = SFX.toggleMute();
    const btn = document.getElementById('mute-btn');
    btn.textContent = isMuted ? '🔇' : '🔊';
    btn.classList.toggle('muted', isMuted);
  });
}

init();
