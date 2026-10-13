// ============================================================
// GAME.JS — Client-side game controller
// Handles: board rendering, UI events, networking (host/client)
// ============================================================

// ── Session data from lobby ───────────────────────────────────
const RAW = JSON.parse(sessionStorage.getItem('gameData') || 'null');
if (!RAW) { window.location.href = 'index.html'; }

const IS_HOST      = RAW.isHost;
const MY_PEER_ID   = RAW.peerId;
const MY_NAME      = RAW.myName;
const MY_COLOR_IDX = RAW.myColorIdx;
const GAME_SETTINGS= RAW.settings;
const INIT_PLAYERS = RAW.players; // [{peerId, name, colorIdx, team?}]

let engine = null;        // GameEngine — only host creates this
let net    = null;        // PeerNetwork
let gameState = null;     // Latest state (from engine or from host broadcast)
let myPlayerId = null;    // My player's id in state
let currentTradeId = null;// For pending trade acceptance

// ── Reconnect to peers ────────────────────────────────────────
function initNetwork() {
  net = new PeerNetwork(
    onNetMessage, onNetConnect, onNetDisconnect, onNetError
  );

  if (IS_HOST) {
    net.createRoom(MY_NAME, (res) => {
      if (!res.ok) { showToast('Ошибка сети', 'error'); return; }
      // Re-accept all client connections (they'll reconnect)
      console.log('[GAME] Host ready at', res.peerId);
      hideConnecting();

      // Assign IDs and init engine
      const players = INIT_PLAYERS.map((p, i) => ({
        ...p,
        id: 'p' + i,
        team: GAME_SETTINGS.teamMode ? (i % (GAME_SETTINGS.teamCount || 2)) : null,
      }));
      myPlayerId = players.find(p => p.peerId === MY_PEER_ID)?.id || 'p0';

      engine = new GameEngine(GAME_SETTINGS, players);
      gameState = engine.getPublicState();

      renderBoard();
      renderPlayers();
      updateActionBar();
      addLog('Игра началась! Удачи всем!');
    });
  } else {
    // Client: connect to host
    const hostId = RAW.hostId;
    net.joinRoom(hostId, MY_NAME, (res) => {
      if (!res.ok) {
        showToast('Не удалось подключиться к хосту', 'error');
        return;
      }
      // Tell host who we are
      net.sendToHost({ type: 'game_reconnect', peerId: MY_PEER_ID, name: MY_NAME });
      hideConnecting();
      addLog('Подключено к игре!');
    });
  }
}

function onNetConnect(peerId) {
  if (IS_HOST) {
    console.log('[GAME] Client reconnected:', peerId);
    // Send current state
    net.sendTo(peerId, { type: 'state_sync', state: gameState });
  }
}

function onNetDisconnect(peerId) {
  if (IS_HOST) {
    showToast('Игрок отключился', 'error');
    // Mark them inactive but don't end game
    if (gameState) {
      const p = gameState.players.find(x => x.peerId === peerId);
      if (p) {
        addLog(p.name + ' отключился');
      }
    }
  } else {
    showToast('Соединение с хостом потеряно', 'error');
  }
}

function onNetError(msg) { showToast(msg, 'error'); }

function onNetMessage(fromPeerId, rawData) {
  let data;
  try { data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData; }
  catch(e) { return; }

  if (IS_HOST) {
    handleHostMessage(fromPeerId, data);
  } else {
    handleClientMessage(data);
  }
}

// ── HOST: handle incoming actions from clients ─────────────────
function handleHostMessage(fromPeerId, data) {
  if (data.type === 'game_reconnect') {
    net.sendTo(fromPeerId, { type: 'state_sync', state: gameState });
    return;
  }

  if (data.type === 'action') {
    const result = engine.handleAction(fromPeerId, data.action);
    if (!result.ok) {
      net.sendTo(fromPeerId, { type: 'error', msg: result.error });
      return;
    }
    gameState = result.state;
    // Broadcast new state to all
    net.broadcast({ type: 'state_sync', state: gameState, events: result.events });
    // Apply locally
    applyEvents(result.events);
    renderAll();
  }
}

// ── CLIENT: handle state from host ────────────────────────────
function handleClientMessage(data) {
  switch(data.type) {
    case 'state_sync':
      gameState = data.state;
      if (!myPlayerId) {
        const p = gameState.players.find(x => x.peerId === MY_PEER_ID);
        if (p) myPlayerId = p.id;
      }
      if (data.events) applyEvents(data.events);
      renderAll();
      break;
    case 'error':
      showToast(data.msg, 'error');
      break;
  }
}

// ── Send action (client → host, or host processes directly) ───
function sendAction(action) {
  if (!gameState) return;
  if (IS_HOST) {
    const result = engine.handleAction(MY_PEER_ID, action);
    if (!result.ok) { showToast(result.error, 'error'); return; }
    gameState = result.state;
    net.broadcast({ type: 'state_sync', state: gameState, events: result.events });
    applyEvents(result.events);
    renderAll();
  } else {
    net.sendToHost({ type: 'action', action });
  }
}

// ── Apply events (animations, popups, etc.) ────────────────────
function applyEvents(events) {
  if (!events) return;
  events.forEach(ev => {
    switch(ev.type) {
      case 'dice_rolled':
        animateDice(ev.dice);
        break;
      case 'card_drawn':
        showCardPopup(ev.deck, ev.card);
        break;
      case 'buy_offer':
        if (ev.player === myPlayerId) showBuyOffer(ev.squareId, ev.price);
        break;
      case 'auction_start':
        showAuctionModal(ev.squareId, ev.startBid);
        break;
      case 'auction_bid':
        updateAuctionDisplay(ev.amount, ev.player);
        break;
      case 'auction_won':
        closeModal('auction-modal');
        showToast(getPlayerName(ev.player) + ' выиграл аукцион!', 'success');
        break;
      case 'auction_no_winner':
        closeModal('auction-modal');
        break;
      case 'trade_offered':
        if (ev.from !== myPlayerId) {
          showIncomingTrade(ev.tradeId, ev.from, ev.trade);
        }
        break;
      case 'trade_completed':
        closeModal('trade-offer-modal');
        closeModal('trade-modal');
        showToast('Сделка завершена!', 'success');
        break;
      case 'trade_rejected':
        closeModal('trade-offer-modal');
        showToast('Сделка отклонена', 'error');
        break;
      case 'sent_to_jail':
        if (ev.player === myPlayerId) {
          setTimeout(() => UI.showJailModal(), 600);
        }
        break;
      case 'game_over':
        showWinnerScreen(ev.winner, ev.winnerTeam);
        break;
      case 'log':
        addLog(ev.msg);
        break;
      case 'money_changed':
        animateMoneyChange(ev.player, ev.amount);
        break;
      case 'turn_changed':
        if (ev.player === myPlayerId && gameState?.players.find(p=>p.id===ev.player)?.inJail) {
          setTimeout(() => UI.showJailModal(), 400);
        }
        break;
    }
  });
}

// ── Game actions ───────────────────────────────────────────────
const Game = {
  rollDice() {
    sendAction({ type: 'roll_dice' });
  },
  rollDiceJail() {
    sendAction({ type: 'jail_roll' });
  },
  jailPay() {
    sendAction({ type: 'jail_pay' });
  },
  jailCard() {
    sendAction({ type: 'jail_card' });
  },
  buyProperty() {
    if (!gameState?.pendingAction) return;
    sendAction({ type: 'buy_property', squareId: gameState.pendingAction.squareId });
    closeModal('buy-modal');
    document.getElementById('btn-buy').style.display = 'none';
  },
  passBuy() {
    sendAction({ type: 'end_turn' });
  },
  endTurn() {
    if (gameState?.pendingAction?.type === 'buy_offer' && isMyTurn()) {
      // Player chose not to buy
      sendAction({ type: 'end_turn' });
    } else {
      sendAction({ type: 'end_turn' });
    }
  },
  buildHouse(squareId, sell=false) {
    sendAction({ type: 'build_house', squareId, sell });
  },
  mortgage(squareId, redeem=false) {
    sendAction({ type: 'mortgage', squareId, redeem });
  },
  sendTrade() {
    const targetId  = selectedTradeTarget;
    const myMoney   = parseInt(document.getElementById('trade-my-money').value)   || 0;
    const theirMoney= parseInt(document.getElementById('trade-their-money').value) || 0;

    const myProps    = [...document.querySelectorAll('#trade-my-props    input[type=checkbox]:checked')].map(c=>parseInt(c.value));
    const theirProps = [...document.querySelectorAll('#trade-their-props input[type=checkbox]:checked')].map(c=>parseInt(c.value));

    sendAction({
      type: 'trade_offer',
      trade: {
        to:      targetId,
        offer:   { money: myMoney,    properties: myProps    },
        request: { money: theirMoney, properties: theirProps },
      }
    });
    closeModal('trade-modal');
  },
  acceptTrade() {
    sendAction({ type: 'trade_accept', tradeId: currentTradeId });
    currentTradeId = null;
  },
  rejectTrade() {
    sendAction({ type: 'trade_reject', tradeId: currentTradeId });
    currentTradeId = null;
  },
  auctionBid() {
    const amount = parseInt(document.getElementById('auction-my-bid').value);
    if (!amount || isNaN(amount)) { showToast('Введите ставку', 'error'); return; }
    sendAction({ type: 'auction_bid', amount });
  },
  auctionPass() {
    sendAction({ type: 'auction_pass' });
    document.getElementById('auction-actions').style.display = 'none';
    document.getElementById('auction-spectate').style.display = 'block';
  },
};

// ── Board rendering ────────────────────────────────────────────
function renderBoard() {
  const board = document.getElementById('board');
  // Remove existing squares (keep center)
  board.querySelectorAll('.sq').forEach(el => el.remove());

  BOARD.forEach(sq => {
    const { row, col } = getGridPos(sq.id);
    const side         = getBoardSide(sq.id);
    const el           = document.createElement('div');
    el.className       = 'sq side-' + side;
    el.id              = 'sq-' + sq.id;
    el.style.gridRow   = row;
    el.style.gridColumn= col;
    el.innerHTML       = buildSquareHTML(sq, side);
    // Apply type-specific CSS class
    const typeClass = {
      'station':        'sq-station',
      'utility':        'sq-utility',
      'chance':         'sq-chance',
      'community_chest':'sq-community',
      'tax':            'sq-tax',
      'go':             'sq-go',
      'jail':           'sq-jail',
      'free_parking':   'sq-free-parking',
      'go_to_jail':     'sq-go-to-jail',
    }[sq.type];
    if (typeClass) el.classList.add(typeClass);
    el.onclick         = () => onSquareClick(sq.id);
    board.appendChild(el);
  });

  scaleBoardToFit();
}

function buildSquareHTML(sq, side) {
  if (side === 'corner') return buildCornerHTML(sq);

  // Determine extra CSS class for this square type
  const typeClass = {
    'station':        'sq-station',
    'utility':        'sq-utility',
    'chance':         'sq-chance',
    'community_chest':'sq-community',
    'tax':            'sq-tax',
  }[sq.type] || '';

  let html = '';

  // Color strip
  if (sq.type === 'property') {
    const grp = GROUPS[sq.group];
    html += `<div class="sq-strip" style="background:${grp.color};"></div>`;
  } else if (sq.type === 'station') {
    html += `<div class="sq-strip" style="background:#424242;"></div>`;
  } else if (sq.type === 'utility') {
    html += `<div class="sq-strip" style="background:#5D4037;"></div>`;
  } else if (sq.type === 'chance') {
    html += `<div class="sq-strip" style="background:#F9A825;"></div>`;
  } else if (sq.type === 'community_chest') {
    html += `<div class="sq-strip" style="background:#1565C0;"></div>`;
  } else if (sq.type === 'tax') {
    html += `<div class="sq-strip" style="background:#B71C1C;"></div>`;
  }

  // typeClass is applied to the outer element after creation (see renderBoard)

  // Name + price
  const displayName = sq.name.replace(/\n/g, '<br>');
  html += `<div class="sq-name">`;

  // Icon for special squares
  if (sq.type === 'station') {
    html += `<div style="font-size:13px;margin-bottom:2px;">${stationSVG()}</div>`;
  } else if (sq.type === 'chance') {
    html += `<div style="font-size:14px;margin-bottom:2px;">${chanceSVG()}</div>`;
  } else if (sq.type === 'community_chest') {
    html += `<div style="font-size:14px;margin-bottom:2px;">${chestSVG()}</div>`;
  } else if (sq.type === 'tax') {
    html += `<div style="font-size:12px;margin-bottom:2px;">${taxSVG()}</div>`;
  } else if (sq.type === 'utility') {
    html += `<div style="font-size:14px;margin-bottom:2px;">${utilitySVG()}</div>`;
  }

  html += `<div class="sq-name-text">${displayName}</div>`;
  if (sq.price) html += `<div class="sq-price">$${sq.price}</div>`;
  if (sq.amount) html += `<div class="sq-price">$${sq.amount}</div>`;
  html += `</div>`;

  // Buildings placeholder
  html += `<div class="sq-buildings" id="bld-${sq.id}"></div>`;
  // Owner bar placeholder
  html += `<div class="sq-owner-bar" id="own-${sq.id}" style="display:none;"></div>`;
  // Tokens placeholder
  html += `<div class="sq-tokens" id="tok-${sq.id}"></div>`;

  return html;
}

function buildCornerHTML(sq) {
  const icons = {
    go:           `<div class="corner-icon">${goSVG()}</div><div class="corner-label">СТАРТ<br><small style="font-size:7px;">Получите $200</small></div>`,
    jail:         `<div class="corner-icon">${jailSVG()}</div><div class="corner-label">ТЮРЬМА<br><small style="font-size:7px;">Просто посещение</small></div>`,
    free_parking: `<div class="corner-icon">${parkingSVG()}</div><div class="corner-label">БЕСПЛАТНАЯ<br>ПАРКОВКА</div>`,
    go_to_jail:   `<div class="corner-icon">${goJailSVG()}</div><div class="corner-label">ИДТИ В<br>ТЮРЬМУ</div>`,
  };
  const icon    = icons[sq.type] || '';
  const classes = {
    go:           'sq-go',
    jail:         'sq-jail',
    free_parking: 'sq-free-parking',
    go_to_jail:   'sq-go-to-jail',
  }[sq.type] || '';

  return `<div class="corner-icon-wrap" style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px;">
    ${icon}
    <div class="sq-tokens" id="tok-${sq.id}" style="position:relative;display:flex;flex-wrap:wrap;gap:2px;justify-content:center;"></div>
  </div>`;
}

// Helpers to add class after creation (used in buildSquareHTML)
function el_addClass(sq, cls) {
  // This is called before element is in DOM; we add via outer div click
  // Actually we do it by setting it on the outer el via side class
  // Handled by CSS .sq.sq-xxx selectors
}

// Scale board to fit the board-area
function scaleBoardToFit() {
  const boardEl = document.getElementById('board');
  const areaEl  = document.getElementById('board-area');
  if (!boardEl || !areaEl) return;

  const areaW = areaEl.clientWidth  - 24;
  const areaH = areaEl.clientHeight - 24;
  const boardNaturalW = parseInt(getComputedStyle(boardEl).getPropertyValue('--corner-w')) * 2 +
                        parseInt(getComputedStyle(boardEl).getPropertyValue('--sq-w'))    * 9;
  const boardNaturalH = boardNaturalW; // square board

  // Re-compute from CSS variables
  const cw = 90, sw = 62; // corner and square width (matches CSS :root)
  const boardSize = cw * 2 + sw * 9; // = 738px

  const scale = Math.min(areaW / boardSize, areaH / boardSize, 1);
  boardEl.style.transform      = `scale(${scale})`;
  boardEl.style.transformOrigin= 'center center';
}

window.addEventListener('resize', scaleBoardToFit);

// ── Render everything ──────────────────────────────────────────
function renderAll() {
  if (!gameState) return;
  renderPlayers();
  renderProperties();
  renderTokens();
  updateActionBar();
  updateBankInfo();
  updateTurnIndicator();
  checkPendingAction();
}

// ── Player sidebar ─────────────────────────────────────────────
function renderPlayers() {
  if (!gameState) return;
  const container = document.getElementById('player-list');
  container.innerHTML = '';

  gameState.players.forEach(p => {
    const token      = PLAYER_TOKENS[p.colorIdx] || PLAYER_TOKENS[0];
    const isActive   = p.id === gameState.players[gameState.currentPlayerIdx]?.id;
    const isBankrupt = p.isBankrupt;
    const isMe       = p.id === myPlayerId;

    const div = document.createElement('div');
    div.className = `player-card ${isActive ? 'active' : ''} ${isBankrupt ? 'bankrupt' : ''}`;
    div.id = 'pcard-' + p.id;

    let statusHtml = '';
    if (p.inJail)   statusHtml += '<span class="jail-indicator">В тюрьме</span>';
    if (isBankrupt) statusHtml += '<span class="jail-indicator" style="background:rgba(239,83,80,.2);color:#EF9A9A;">Банкрот</span>';
    if (p.team !== null) {
      const teamColors = ['#1E88E5','#E53935','#43A047','#FDD835'];
      statusHtml += `<span class="team-badge" style="background:${teamColors[p.team % teamColors.length]}20;color:${teamColors[p.team % teamColors.length]};">Команда ${p.team + 1}</span>`;
    }

    div.innerHTML = `
      ${isActive ? '<div class="player-turn-indicator"></div>' : ''}
      <div class="player-token-3d" style="background:radial-gradient(circle at 35% 35%, ${lighten(token.color)}, ${token.color}, ${token.dark});"></div>
      <div class="player-info">
        <div class="player-name">${escHtml(p.name)} ${isMe ? '<span style="color:var(--gold-light);font-size:11px;">(Вы)</span>' : ''}</div>
        <div class="player-money">$${p.money.toLocaleString()}</div>
        <div class="player-status">${statusHtml}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ── Property markers (owner bars, buildings) ────────────────────
function renderProperties() {
  if (!gameState) return;

  BOARD.forEach(sq => {
    if (!['property','station','utility'].includes(sq.type)) return;
    const prop     = gameState.properties[sq.id];
    const ownerBar = document.getElementById('own-' + sq.id);
    const buildEl  = document.getElementById('bld-' + sq.id);
    const sqEl     = document.getElementById('sq-' + sq.id);
    if (!ownerBar || !buildEl || !sqEl) return;

    if (prop.owner) {
      const p     = gameState.players.find(x => x.id === prop.owner);
      const token = PLAYER_TOKENS[(p?.colorIdx) ?? 0];
      ownerBar.style.display    = 'block';
      ownerBar.style.background = token.color;
    } else {
      ownerBar.style.display = 'none';
    }

    // Mortgaged
    if (prop.mortgaged) sqEl.classList.add('mortgaged');
    else                sqEl.classList.remove('mortgaged');

    // Buildings
    buildEl.innerHTML = '';
    if (prop.hotel) {
      const h = document.createElement('div');
      h.className = 'hotel-icon';
      h.title = 'Отель';
      buildEl.appendChild(h);
    } else {
      for (let i = 0; i < prop.houses; i++) {
        const h = document.createElement('div');
        h.className = 'house-icon';
        h.title = `Дом ${i+1}`;
        buildEl.appendChild(h);
      }
    }
  });
}

// ── Token positions ────────────────────────────────────────────
function renderTokens() {
  if (!gameState) return;

  // Clear all token containers
  document.querySelectorAll('.sq-tokens').forEach(el => el.innerHTML = '');

  // Group players by position
  const byPos = {};
  gameState.players.forEach(p => {
    if (!p.isBankrupt) {
      if (!byPos[p.position]) byPos[p.position] = [];
      byPos[p.position].push(p);
    }
  });

  Object.entries(byPos).forEach(([pos, players]) => {
    const container = document.getElementById('tok-' + pos);
    if (!container) return;
    players.forEach(p => {
      const token = PLAYER_TOKENS[p.colorIdx] || PLAYER_TOKENS[0];
      const div   = document.createElement('div');
      div.className = 'token';
      div.style.background = `radial-gradient(circle at 35% 30%, ${lighten(token.color)}, ${token.color}, ${token.dark})`;
      div.title = p.name;
      div.id    = 'token-' + p.id;
      container.appendChild(div);
    });
  });
}

// ── Action bar ─────────────────────────────────────────────────
function updateActionBar() {
  if (!gameState) return;
  const isMyTurnNow = isMyTurn();
  const diceRolled  = gameState.diceRolled;
  const hasPending  = !!gameState.pendingAction;
  const me          = gameState.players.find(p => p.id === myPlayerId);
  const inJail      = me?.inJail;

  document.getElementById('btn-roll').disabled =
    !isMyTurnNow || diceRolled || (hasPending && gameState.pendingAction?.type !== 'buy_offer');

  document.getElementById('btn-end').disabled =
    !isMyTurnNow || !diceRolled || (hasPending && gameState.pendingAction?.type === 'auction');

  document.getElementById('btn-build').disabled    = !isMyTurnNow;
  document.getElementById('btn-trade').disabled    = false; // can trade anytime
  document.getElementById('btn-mortgage').disabled = !isMyTurnNow;

  // Buy button
  const buyBtn = document.getElementById('btn-buy');
  if (isMyTurnNow && hasPending && gameState.pendingAction?.type === 'buy_offer' &&
      gameState.pendingAction?.player === myPlayerId) {
    buyBtn.style.display = '';
    buyBtn.textContent   = `Купить $${gameState.pendingAction.price}`;
  } else {
    buyBtn.style.display = 'none';
  }
}

function isMyTurn() {
  if (!gameState) return false;
  const cur = gameState.players[gameState.currentPlayerIdx];
  return cur?.id === myPlayerId;
}

// ── Turn indicator ─────────────────────────────────────────────
function updateTurnIndicator() {
  if (!gameState) return;
  const cur = gameState.players[gameState.currentPlayerIdx];
  const el  = document.getElementById('turn-indicator');
  if (!cur) return;
  const arrow = cur.id === myPlayerId ? ' — ВАШ ХОД!' : '';
  el.textContent = `Ход: ${cur.name}${arrow}`;
  el.style.color = cur.id === myPlayerId ? 'var(--gold)' : 'var(--gold-light)';
}

// ── Bank info ──────────────────────────────────────────────────
function updateBankInfo() {
  if (!gameState) return;
  document.getElementById('house-bank').textContent   = gameState.houseBank;
  document.getElementById('hotel-bank').textContent   = gameState.hotelBank;
  document.getElementById('parking-money').textContent= '$' + gameState.freeParkingMoney;
}

// ── Check pending action and show modals ───────────────────────
function checkPendingAction() {
  if (!gameState) return;
  const pa = gameState.pendingAction;
  if (!pa) return;

  if (pa.type === 'buy_offer' && pa.player === myPlayerId) {
    showBuyOffer(pa.squareId, pa.price);
  }
  if (pa.type === 'auction') {
    updateAuctionDisplay(pa.currentBid, pa.highestBidder);
    const isMyBid = pa.bidders[pa.bidderIdx]?.id === myPlayerId;
    document.getElementById('auction-actions').style.display   = isMyBid ? '' : 'none';
    document.getElementById('auction-spectate').style.display  = isMyBid ? 'none' : '';
  }
  if (pa.type === 'trade' && pa.to === myPlayerId) {
    currentTradeId = pa.id;
    showIncomingTrade(pa.id, pa.from, { offer: pa.offer, request: pa.request });
  }
}

// ── Square click → property info ──────────────────────────────
function onSquareClick(id) {
  const sq   = BOARD[id];
  const prop = gameState?.properties[id];
  if (!sq || !['property','station','utility'].includes(sq.type)) return;

  UI.showPropertyInfo(sq, prop);
}

// ── Dice animation ─────────────────────────────────────────────
function animateDice([d1, d2]) {
  [['die1', d1], ['die2', d2]].forEach(([elId, val]) => {
    const el = document.getElementById(elId);
    el.classList.add('rolling');
    setTimeout(() => {
      el.classList.remove('rolling');
      renderDie(el, val);
    }, 400);
    // Flash during roll
    let cnt = 0;
    const iv = setInterval(() => {
      renderDie(el, Math.ceil(Math.random() * 6));
      if (++cnt > 6) clearInterval(iv);
    }, 60);
  });
}

// Die dot patterns (which of the 9 grid cells have dots)
const DIE_PATTERNS = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function renderDie(el, val) {
  el.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' + (DIE_PATTERNS[val]?.includes(i) ? '' : ' hidden');
    el.appendChild(dot);
  }
}

// Init dice
['die1','die2'].forEach(id => renderDie(document.getElementById(id), 1));

// ── Card popup ─────────────────────────────────────────────────
function showCardPopup(deck, card) {
  const popup = document.getElementById('card-popup');
  const typeEl = document.getElementById('card-popup-type');
  const textEl = document.getElementById('card-popup-text');
  const amtEl  = document.getElementById('card-popup-amount');

  popup.className = 'card-popup ' + (deck === 'chance' ? 'chance-card' : 'community-card');
  typeEl.textContent = deck === 'chance' ? 'ШАНС' : 'ОБЩАЯ КАЗНА';
  textEl.textContent = card.text;

  if (card.amount) {
    amtEl.textContent = (card.action === 'pay' || card.action === 'pay_each') ? '-$'+card.amount : '+$'+card.amount;
    amtEl.style.color = (card.action === 'pay' || card.action === 'pay_each') ? '#EF9A9A' : '#81C784';
  } else {
    amtEl.textContent = '';
  }

  popup.classList.add('show');

  // Also show in board center
  const cd = document.getElementById('card-display');
  cd.className = 'card-display ' + (deck === 'chance' ? 'chance' : 'community');
  cd.innerHTML = `<div class="card-title">${deck === 'chance' ? 'ШАНС' : 'КАЗНА'}</div>
                  <div class="card-text">${card.text}</div>`;
  cd.style.display = 'block';
  setTimeout(() => { cd.style.display = 'none'; }, 4000);
}

function closeCardPopup() {
  document.getElementById('card-popup').classList.remove('show');
}

// ── Buy offer ──────────────────────────────────────────────────
function showBuyOffer(squareId, price) {
  const sq   = BOARD[squareId];
  const grp  = sq.group !== undefined ? GROUPS[sq.group] : null;

  document.getElementById('buy-modal-title').textContent = `Купить ${sq.name}?`;
  document.getElementById('buy-modal-body').innerHTML =
    `<div style="text-align:center;">
      ${grp ? `<div style="width:60px;height:8px;background:${grp.color};border-radius:4px;margin:0 auto 12px;"></div>` : ''}
      <div style="font-size:32px;font-weight:700;color:var(--gold);font-family:'Oswald',sans-serif;">$${price}</div>
      ${sq.rent ? `<div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:8px;">Базовая аренда: $${sq.rent[0]}</div>` : ''}
     </div>`;

  openModal('buy-modal');
}

// ── Property info modal ────────────────────────────────────────
const UI = {
  showPropertyInfo(sq, prop) {
    const grp     = sq.group !== undefined ? GROUPS[sq.group] : null;
    const owner   = prop?.owner ? gameState.players.find(p => p.id === prop.owner) : null;
    const canBuy  = isMyTurn() && gameState?.pendingAction?.type === 'buy_offer'
                    && gameState.pendingAction.squareId === sq.id;

    const header  = document.getElementById('prop-modal-header');
    header.style.background = grp ? grp.color : '#424242';
    header.textContent      = grp ? grp.name : (sq.type === 'station' ? 'СТАНЦИЯ' : 'УСЛУГА');

    document.getElementById('prop-modal-name').textContent  = sq.name;
    document.getElementById('prop-modal-price').textContent = sq.price ? `Цена: $${sq.price}` : '';

    let body = '';
    if (owner) {
      const tok = PLAYER_TOKENS[owner.colorIdx];
      body += `<div style="background:${tok.color}20;border:1px solid ${tok.color}40;border-radius:8px;padding:8px 12px;margin-bottom:12px;color:${tok.color};font-weight:700;">Владелец: ${owner.name}</div>`;
      if (prop.mortgaged) body += `<div style="color:#EF9A9A;font-size:12px;margin-bottom:8px;">ЗАЛОЖЕНО — аренда не взимается</div>`;
    }

    if (sq.rent) {
      body += `<table class="rent-table">
        <tr><td>Базовая аренда</td><td>$${sq.rent[0]}</td></tr>
        <tr><td>Полная группа</td><td>$${sq.rent[0]*2}</td></tr>
        <tr><td>1 дом</td><td>$${sq.rent[1]}</td></tr>
        <tr><td>2 дома</td><td>$${sq.rent[2]}</td></tr>
        <tr><td>3 дома</td><td>$${sq.rent[3]}</td></tr>
        <tr><td>4 дома</td><td>$${sq.rent[4]}</td></tr>
        <tr><td>Отель</td><td>$${sq.rent[5]}</td></tr>
      </table>`;
      body += `<div style="font-size:11px;color:rgba(255,255,255,.5);">Стоимость постройки: $${sq.buildCost} за дом/отель</div>`;
      body += `<div style="font-size:11px;color:rgba(255,255,255,.5);">Залог: $${sq.mortgage}</div>`;
    } else if (sq.type === 'station') {
      body += `<table class="rent-table">
        ${sq.rent.map((r,i) => `<tr><td>${i+1} станция</td><td>$${r}</td></tr>`).join('')}
      </table>`;
      body += `<div style="font-size:11px;color:rgba(255,255,255,.5);">Залог: $${sq.mortgage}</div>`;
    } else if (sq.type === 'utility') {
      body += `<div style="color:rgba(255,255,255,.7);font-size:13px;line-height:1.6;">
        1 компания: 4 × кубики<br>
        2 компании: 10 × кубики
      </div>`;
    }

    document.getElementById('prop-modal-body').innerHTML = body;
    document.getElementById('prop-modal-buy').style.display = canBuy ? '' : 'none';
    openModal('prop-modal');
  },

  showBuildModal() {
    if (!gameState || !myPlayerId) return;
    const me = gameState.players.find(p => p.id === myPlayerId);
    if (!me) return;

    const myProps = BOARD.filter(sq =>
      sq.type === 'property' &&
      gameState.properties[sq.id]?.owner === myPlayerId
    );

    // Group by color group
    const grouped = {};
    myProps.forEach(sq => {
      if (!grouped[sq.group]) grouped[sq.group] = [];
      grouped[sq.group].push(sq);
    });

    const list = document.getElementById('build-list');
    list.innerHTML = '';

    let hasAny = false;
    Object.entries(grouped).forEach(([gId, sqs]) => {
      const grp        = GROUPS[parseInt(gId)];
      const allOwned   = BOARD.filter(s => s.type === 'property' && s.group === parseInt(gId))
                              .every(s => gameState.properties[s.id]?.owner === myPlayerId);
      if (!allOwned) return; // Can only build if full group

      hasAny = true;
      sqs.forEach(sq => {
        const prop  = gameState.properties[sq.id];
        const level = prop.hotel ? 5 : prop.houses;
        const label = prop.hotel ? 'Отель' : (prop.houses === 0 ? 'Пусто' : `${prop.houses} дом(а)`);

        const item = document.createElement('div');
        item.className = 'build-item';
        item.innerHTML = `
          <div class="build-item-color" style="background:${grp.color};"></div>
          <div class="build-item-info">
            <div class="build-item-name">${sq.name}</div>
            <div class="build-item-level">${label} · Строить: $${sq.buildCost}</div>
          </div>
          <div class="build-item-actions">
            <button class="build-btn build-btn-sell" title="Продать" ${level===0?'disabled':''} onclick="Game.buildHouse(${sq.id}, true); UI.showBuildModal();">−</button>
            <button class="build-btn build-btn-add"  title="Построить" ${level>=5||me.money<sq.buildCost?'disabled':''} onclick="Game.buildHouse(${sq.id}, false); UI.showBuildModal();">+</button>
          </div>
        `;
        list.appendChild(item);
      });
    });

    if (!hasAny) {
      list.innerHTML = '<div style="color:rgba(255,255,255,.5);text-align:center;padding:20px;">У вас нет полных групп для строительства</div>';
    }
    openModal('build-modal');
  },

  showMortgageModal() {
    if (!gameState || !myPlayerId) return;
    const list = document.getElementById('mortgage-list');
    list.innerHTML = '';

    const myProps = BOARD.filter(sq =>
      ['property','station','utility'].includes(sq.type) &&
      gameState.properties[sq.id]?.owner === myPlayerId
    );

    if (myProps.length === 0) {
      list.innerHTML = '<div style="color:rgba(255,255,255,.5);text-align:center;padding:20px;">Нет собственности</div>';
    } else {
      myProps.forEach(sq => {
        const prop      = gameState.properties[sq.id];
        const mortgaged = prop.mortgaged;
        const grp       = sq.group !== undefined ? GROUPS[sq.group] : null;
        const hasBuildings = prop.houses > 0 || prop.hotel;

        const item = document.createElement('div');
        item.className = 'build-item';
        item.innerHTML = `
          <div class="build-item-color" style="background:${grp ? grp.color : '#424242'};"></div>
          <div class="build-item-info">
            <div class="build-item-name">${sq.name} ${mortgaged ? '<span style="color:#EF9A9A;font-size:10px;">[ЗАЛОГ]</span>' : ''}</div>
            <div class="build-item-level">${mortgaged ? 'Выкуп: $'+Math.floor(sq.mortgage*1.1) : 'Залог: $'+sq.mortgage}</div>
          </div>
          <div class="build-item-actions">
            ${!mortgaged
              ? `<button class="build-btn" style="background:#8E24AA;color:#fff;" ${hasBuildings?'disabled':''} title="Заложить" onclick="Game.mortgage(${sq.id}, false);">З</button>`
              : `<button class="build-btn" style="background:#2E7D32;color:#fff;" title="Выкупить" onclick="Game.mortgage(${sq.id}, true);">В</button>`
            }
          </div>
        `;
        list.appendChild(item);
      });
    }
    openModal('mortgage-modal');
  },

  showTradeModal() {
    if (!gameState) return;
    const list = document.getElementById('trade-player-list');
    list.innerHTML = '';
    selectedTradeTarget = null;
    document.getElementById('trade-form').style.display = 'none';
    document.getElementById('trade-select-hint').style.display = 'block';

    gameState.players
      .filter(p => p.id !== myPlayerId && !p.isBankrupt)
      .forEach(p => {
        const token = PLAYER_TOKENS[p.colorIdx];
        const item  = document.createElement('div');
        item.className = 'player-select-item';
        item.innerHTML = `
          <div style="width:28px;height:28px;border-radius:50%;background:${token.color};" ></div>
          <div style="color:#fff;font-weight:600;">${escHtml(p.name)}</div>
        `;
        item.onclick = () => {
          list.querySelectorAll('.player-select-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          selectedTradeTarget = p.id;
          showTradeForm(p);
        };
        list.appendChild(item);
      });

    openModal('trade-modal');
  },

  showJailModal() {
    if (!gameState) return;
    const me = gameState.players.find(p => p.id === myPlayerId);
    if (!me?.inJail) return;

    const cardOption = document.getElementById('jail-card-option');
    if (me.getOutOfJailCards > 0) {
      cardOption.style.display = '';
      document.getElementById('jail-card-count').textContent = `У вас ${me.getOutOfJailCards} карточка`;
    } else {
      cardOption.style.display = 'none';
    }

    const payOption = document.getElementById('jail-pay-option');
    payOption.style.opacity = me.money >= 50 ? '1' : '.4';

    const rollOption = document.getElementById('jail-roll-option');
    const turnsLeft  = CONFIG.jailMaxTurns - me.jailTurns;
    rollOption.querySelector('.jail-option-desc').textContent =
      `Выйти при дубле (осталось попыток: ${turnsLeft})`;

    openModal('jail-modal');
  },

  showRules() { openModal('rules-modal'); },
  showMenu()  { openModal('menu-modal');  },
};

// ── Trade form ─────────────────────────────────────────────────
let selectedTradeTarget = null;

function showTradeForm(targetPlayer) {
  document.getElementById('trade-select-hint').style.display = 'none';
  document.getElementById('trade-form').style.display = 'block';
  document.getElementById('trade-my-money').value    = '';
  document.getElementById('trade-their-money').value = '';

  // My properties
  const myPropsEl = document.getElementById('trade-my-props');
  myPropsEl.innerHTML = '';
  BOARD.filter(sq =>
    ['property','station','utility'].includes(sq.type) &&
    gameState.properties[sq.id]?.owner === myPlayerId
  ).forEach(sq => {
    const grp = sq.group !== undefined ? GROUPS[sq.group] : null;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.8);font-size:12px;cursor:pointer;';
    row.innerHTML = `
      <input type="checkbox" value="${sq.id}" style="accent-color:var(--gold);">
      <span style="width:8px;height:8px;border-radius:50%;background:${grp ? grp.color : '#424242'};flex-shrink:0;"></span>
      ${sq.name}
    `;
    myPropsEl.appendChild(row);
  });

  // Their properties
  const theirPropsEl = document.getElementById('trade-their-props');
  theirPropsEl.innerHTML = '';
  BOARD.filter(sq =>
    ['property','station','utility'].includes(sq.type) &&
    gameState.properties[sq.id]?.owner === targetPlayer.id
  ).forEach(sq => {
    const grp = sq.group !== undefined ? GROUPS[sq.group] : null;
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.8);font-size:12px;cursor:pointer;';
    row.innerHTML = `
      <input type="checkbox" value="${sq.id}" style="accent-color:var(--gold);">
      <span style="width:8px;height:8px;border-radius:50%;background:${grp ? grp.color : '#424242'};flex-shrink:0;"></span>
      ${sq.name}
    `;
    theirPropsEl.appendChild(row);
  });
}

function showIncomingTrade(tradeId, fromId, trade) {
  currentTradeId = tradeId;
  const from = gameState.players.find(p => p.id === fromId);

  const offerPropNames  = (trade.offer?.properties || []).map(id => BOARD[id]?.name).join(', ');
  const requestPropNames= (trade.request?.properties || []).map(id => BOARD[id]?.name).join(', ');

  document.getElementById('trade-offer-body').innerHTML = `
    <div style="margin-bottom:12px;font-weight:700;color:var(--gold-light);">${from?.name || '?'} предлагает:</div>
    <div class="trade-section">
      <div class="trade-section-title">Вам предлагают</div>
      ${trade.offer?.money ? `<div style="color:#81C784;font-size:18px;font-weight:700;">$${trade.offer.money}</div>` : ''}
      ${offerPropNames ? `<div style="color:rgba(255,255,255,.7);font-size:13px;">${offerPropNames}</div>` : ''}
      ${!trade.offer?.money && !offerPropNames ? '<div style="color:rgba(255,255,255,.4);">Ничего</div>' : ''}
    </div>
    <div class="trade-section" style="margin-top:8px;">
      <div class="trade-section-title">Запрашивает у вас</div>
      ${trade.request?.money ? `<div style="color:#EF9A9A;font-size:18px;font-weight:700;">$${trade.request.money}</div>` : ''}
      ${requestPropNames ? `<div style="color:rgba(255,255,255,.7);font-size:13px;">${requestPropNames}</div>` : ''}
      ${!trade.request?.money && !requestPropNames ? '<div style="color:rgba(255,255,255,.4);">Ничего</div>' : ''}
    </div>
  `;
  openModal('trade-offer-modal');
}

// ── Auction ────────────────────────────────────────────────────
function showAuctionModal(squareId, startBid) {
  const sq = BOARD[squareId];
  document.getElementById('auction-prop-name').textContent = sq.name;
  document.getElementById('auction-bid').textContent       = '$' + startBid;
  document.getElementById('auction-bidder').textContent    = 'Лидер: —';
  document.getElementById('auction-my-bid').value          = startBid + 1;
  document.getElementById('auction-actions').style.display  = '';
  document.getElementById('auction-spectate').style.display = 'none';
  openModal('auction-modal');
}

function updateAuctionDisplay(currentBid, highestBidder) {
  document.getElementById('auction-bid').textContent = '$' + currentBid;
  if (highestBidder) {
    const p = gameState?.players.find(x => x.id === highestBidder);
    document.getElementById('auction-bidder').textContent = 'Лидер: ' + (p?.name || '?');
  }
}

// ── Winner screen ──────────────────────────────────────────────
function showWinnerScreen(winnerId, winnerTeam) {
  const screen = document.getElementById('winner-screen');
  screen.style.display = 'flex';

  let name, money;
  if (winnerId) {
    const p = gameState?.players.find(x => x.id === winnerId);
    name  = p?.name || 'Победитель';
    money = p ? '$' + p.money.toLocaleString() : '';
  } else {
    name  = `Команда ${winnerTeam + 1}`;
    money = '';
  }

  document.getElementById('winner-name').textContent  = name;
  document.getElementById('winner-money').textContent = money;
  launchConfetti();
}

// ── Confetti ────────────────────────────────────────────────────
function launchConfetti() {
  const wrap = document.getElementById('confetti-wrap');
  const colors = ['#F5A623','#4CAF50','#1E88E5','#E53935','#8E24AA','#FB8C00','#FDD835'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position: absolute;
      width: ${6 + Math.random()*8}px;
      height: ${10 + Math.random()*12}px;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      left: ${Math.random()*100}%;
      top: -20px;
      border-radius: 2px;
      animation: confettiFall ${1.5 + Math.random()*2}s ease-in ${Math.random()*2}s forwards;
      transform: rotate(${Math.random()*360}deg);
    `;
    wrap.appendChild(el);
  }
  // Inject animation
  if (!document.getElementById('confetti-style')) {
    const st = document.createElement('style');
    st.id = 'confetti-style';
    st.textContent = `@keyframes confettiFall { to { top: 110vh; transform: rotate(720deg); } }`;
    document.head.appendChild(st);
  }
}

// ── Money change animation ─────────────────────────────────────
function animateMoneyChange(playerId, amount) {
  const card = document.getElementById('pcard-' + playerId);
  if (!card) return;
  const delta = document.createElement('div');
  delta.className = 'money-delta ' + (amount >= 0 ? 'positive' : 'negative');
  delta.textContent = (amount >= 0 ? '+' : '') + amount;
  card.style.position = 'relative';
  card.appendChild(delta);
  setTimeout(() => delta.remove(), 1500);

  // Flash card
  card.classList.add(amount >= 0 ? 'flash-green' : 'flash-red');
  setTimeout(() => card.classList.remove('flash-green','flash-red'), 1500);
}

// ── Modal helpers ──────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ── Log ───────────────────────────────────────────────────────
function addLog(msg, important=false) {
  const area  = document.getElementById('log-area');
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (important ? ' important' : '');
  entry.textContent = msg;
  area.insertBefore(entry, area.firstChild);
  if (area.children.length > 50) area.lastChild?.remove();
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showConnecting(msg) {
  document.getElementById('connecting-text').textContent = msg;
  document.getElementById('connecting-overlay').style.display = 'flex';
}
function hideConnecting() {
  document.getElementById('connecting-overlay').style.display = 'none';
}

// ── Utility ────────────────────────────────────────────────────
function getPlayerName(id) {
  return gameState?.players.find(p => p.id === id)?.name || '?';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function lighten(hex) {
  // Lighten a hex color by 30%
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 60);
  const g = Math.min(255, ((n >>  8) & 255) + 60);
  const b = Math.min(255, ( n        & 255) + 60);
  return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
}

// ── SVG icons ─────────────────────────────────────────────────
function goSVG() {
  return `<svg viewBox="0 0 48 48" width="36" height="36">
    <circle cx="24" cy="24" r="22" fill="#C62828"/>
    <text x="24" y="31" font-size="18" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Oswald,sans-serif">GO</text>
    <path d="M4 24 Q24 4 44 24 Q24 44 4 24Z" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1"/>
  </svg>`;
}

function jailSVG() {
  return `<svg viewBox="0 0 48 48" width="32" height="32">
    <rect x="4" y="4" width="40" height="40" rx="4" fill="#424242"/>
    <rect x="8" y="4" width="4" height="40" fill="#616161"/>
    <rect x="18" y="4" width="4" height="40" fill="#616161"/>
    <rect x="28" y="4" width="4" height="40" fill="#616161"/>
    <rect x="38" y="4" width="4" height="40" fill="#616161"/>
    <circle cx="24" cy="24" r="8" fill="#F9A825" opacity=".8"/>
    <text x="24" y="28" font-size="10" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Oswald">ТЮР</text>
  </svg>`;
}

function parkingSVG() {
  return `<svg viewBox="0 0 48 48" width="32" height="32">
    <circle cx="24" cy="24" r="22" fill="#1565C0"/>
    <text x="24" y="33" font-size="26" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Oswald,sans-serif">P</text>
  </svg>`;
}

function goJailSVG() {
  return `<svg viewBox="0 0 48 48" width="32" height="32">
    <circle cx="24" cy="24" r="22" fill="#C62828"/>
    <line x1="8" y1="8" x2="40" y2="40" stroke="#fff" stroke-width="3"/>
    <text x="24" y="22" font-size="9" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Oswald">ИДТИ В</text>
    <text x="24" y="34" font-size="9" text-anchor="middle" fill="#fff" font-weight="bold" font-family="Oswald">ТЮРЬМУ</text>
  </svg>`;
}

function stationSVG() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="#424242">
    <path d="M12 2C8.13 2 5 5.13 5 9v7l-2 2v1h18v-1l-2-2V9c0-3.87-3.13-7-7-7zm0 18c-1.1 0-2-.9-2-2h4c0 1.1-.9 2-2 2z"/>
  </svg>`;
}

function chanceSVG() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="#F9A825">
    <path d="M11.5 2C6.81 2 3 5.81 3 10.5S6.81 19 11.5 19h.5v3c4.86-2.34 8-7 8-11.5C20 5.81 16.19 2 11.5 2zm1 14.5h-2v-2h2v2zm0-4h-2c0-3.25 3-3 3-5 0-1.1-.9-2-2-2s-2 .9-2 2h-2c0-2.21 1.79-4 4-4s4 1.79 4 4c0 2.5-3 2.75-3 5z"/>
  </svg>`;
}

function chestSVG() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="#1565C0">
    <path d="M20 6h-2.18c.07-.44.18-.88.18-1.35C18 2.53 16.5 1 14.65 1c-1.3 0-2.36.68-3 1.7L12 3.4l-.65-.7C10.71 1.68 9.65 1 8.35 1 6.5 1 5 2.53 5 4.65c0 .47.11.91.18 1.35H3c-1.1 0-2 .89-2 2v11c0 1.11.89 2 2 2h17c1.1 0 2-.89 2-2V8c0-1.11-.9-2-2-2z"/>
  </svg>`;
}

function taxSVG() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="#B71C1C">
    <path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>
  </svg>`;
}

function utilitySVG() {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="#5D4037">
    <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
  </svg>`;
}

// ── Bootstrap ─────────────────────────────────────────────────
showConnecting('Подключение к игре...');
initNetwork();
// Render board structure (tokens/props filled after state arrives)
renderBoard();
