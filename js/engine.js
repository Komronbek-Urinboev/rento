// ============================================================
// GAME ENGINE — Authoritative game state & logic
// Only the HOST runs this; clients receive state updates
// ============================================================

class GameEngine {
  constructor(settings, players) {
    this.settings  = settings; // { startMoney, auctionMode, teamMode, teams }
    this.state     = this._initState(players);
    this._chanceIdx = 0;
    this._commIdx   = 0;
    this._chanceDeck = this._shuffle([...CHANCE_CARDS]);
    this._commDeck   = this._shuffle([...COMMUNITY_CARDS]);
  }

  // ── State ──────────────────────────────────────────────────
  _initState(players) {
    const startMoney = this.settings.startMoney || CONFIG.startMoney;

    const props = {};
    BOARD.forEach(sq => {
      if (['property','station','utility'].includes(sq.type)) {
        props[sq.id] = { owner: null, houses: 0, hotel: false, mortgaged: false };
      }
    });

    return {
      phase: 'playing',         // 'playing' | 'ended'
      currentPlayerIdx: 0,
      players: players.map((p, i) => ({
        id: p.id,
        peerId: p.peerId,
        name: p.name,
        colorIdx: i % PLAYER_TOKENS.length,
        position: 0,
        money: startMoney,
        inJail: false,
        jailTurns: 0,
        doublesCount: 0,
        getOutOfJailCards: 0,
        isBankrupt: false,
        team: p.team || null,
      })),
      properties: props,
      dice: [1, 1],
      diceRolled: false,
      diceDouble: false,
      pendingAction: null,   // { type, data } — awaiting player decision
      log: [],
      freeParkingMoney: 0,
      houseBank: CONFIG.maxHouses,
      hotelBank: CONFIG.maxHotels,
      turnCount: 0,
    };
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Accessors ──────────────────────────────────────────────
  get currentPlayer() {
    return this.state.players[this.state.currentPlayerIdx];
  }

  get activePlayers() {
    return this.state.players.filter(p => !p.isBankrupt);
  }

  // ── Public actions (called by host message handler) ────────
  // Returns { ok, events, newState }
  handleAction(peerId, action) {
    const st  = this.state;
    const cur = this.currentPlayer;

    // Safety: only current player can act (unless it's a trade/deal from anyone)
    const tradingActions = ['trade_offer','trade_accept','trade_reject'];
    if (!tradingActions.includes(action.type) && cur.peerId !== peerId) {
      return { ok: false, error: 'Не ваш ход' };
    }

    const events = [];

    switch (action.type) {
      case 'roll_dice':       return this._rollDice(events);
      case 'buy_property':    return this._buyProperty(events, action.squareId);
      case 'auction_bid':     return this._auctionBid(events, peerId, action.amount);
      case 'auction_pass':    return this._auctionPass(events, peerId);
      case 'end_turn':        return this._endTurn(events);
      case 'jail_pay':        return this._jailPay(events);
      case 'jail_card':       return this._jailCard(events);
      case 'jail_roll':       return this._rollDice(events); // same as roll but while in jail
      case 'build_house':     return this._buildHouse(events, action.squareId, action.sell);
      case 'mortgage':        return this._mortgage(events, action.squareId, action.redeem);
      case 'trade_offer':     return this._tradeOffer(events, peerId, action.trade);
      case 'trade_accept':    return this._tradeAccept(events, action.tradeId);
      case 'trade_reject':    return this._tradeReject(events, action.tradeId);
      case 'declare_bankrupt':return this._declareBankrupt(events);
      default:
        return { ok: false, error: 'Неизвестное действие: ' + action.type };
    }
  }

  // ── Roll dice ──────────────────────────────────────────────
  _rollDice(events) {
    const st  = this.state;
    const cur = this.currentPlayer;

    if (st.diceRolled && !cur.inJail) {
      return { ok: false, error: 'Кубики уже брошены' };
    }

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const total = d1 + d2;
    const isDouble = d1 === d2;

    st.dice = [d1, d2];
    st.diceDouble = isDouble;
    st.diceRolled = true;

    events.push({ type: 'dice_rolled', dice: [d1, d2], player: cur.id });
    this._log(events, `${cur.name} бросил кубики: ${d1}+${d2}=${total}`);

    // ── IN JAIL ─────────────────────────────────────────────
    if (cur.inJail) {
      if (isDouble) {
        cur.inJail   = false;
        cur.jailTurns = 0;
        events.push({ type: 'jail_escape', player: cur.id, reason: 'double' });
        this._log(events, `${cur.name} вышел из тюрьмы (дубль)!`);
        this._movePlayer(cur, total, events);
      } else {
        cur.jailTurns++;
        if (cur.jailTurns >= CONFIG.jailMaxTurns) {
          // Must pay
          this._deductMoney(cur, CONFIG.jailFine, events);
          cur.inJail = false;
          cur.jailTurns = 0;
          events.push({ type: 'jail_paid', player: cur.id });
          this._log(events, `${cur.name} вынужден заплатить $${CONFIG.jailFine} и выйти.`);
          this._movePlayer(cur, total, events);
        } else {
          events.push({ type: 'jail_stayed', player: cur.id, turns: cur.jailTurns });
          this._log(events, `${cur.name} остался в тюрьме (попытка ${cur.jailTurns}).`);
          this._endTurnAuto(events);
        }
      }
      return this._result(events);
    }

    // ── TRIPLE DOUBLES → JAIL ───────────────────────────────
    if (isDouble) {
      cur.doublesCount++;
      if (cur.doublesCount >= 3) {
        this._log(events, `${cur.name} трижды выбил дубль — в тюрьму!`);
        this._sendToJail(cur, events);
        this._endTurnAuto(events);
        return this._result(events);
      }
    } else {
      cur.doublesCount = 0;
    }

    // ── MOVE ────────────────────────────────────────────────
    this._movePlayer(cur, total, events);
    return this._result(events);
  }

  // ── Movement ───────────────────────────────────────────────
  _movePlayer(player, steps, events) {
    const oldPos = player.position;
    const newPos = (oldPos + steps) % 40;

    // Passed GO?
    if (newPos < oldPos || (steps > 0 && newPos === 0)) {
      this._addMoney(player, CONFIG.goSalary, events);
      this._log(events, `${player.name} прошёл СТАРТ, получил $${CONFIG.goSalary}`);
      events.push({ type: 'passed_go', player: player.id });
    }

    player.position = newPos;
    events.push({ type: 'player_moved', player: player.id, from: oldPos, to: newPos });
    this._log(events, `${player.name} переходит на ${BOARD[newPos].name}`);

    this._landOnSquare(player, newPos, events);
  }

  _movePlayerTo(player, targetPos, events, collectGo = true) {
    const oldPos = player.position;
    if (collectGo && targetPos <= oldPos && targetPos !== oldPos) {
      this._addMoney(player, CONFIG.goSalary, events);
      events.push({ type: 'passed_go', player: player.id });
      this._log(events, `${player.name} прошёл СТАРТ, получил $${CONFIG.goSalary}`);
    }
    player.position = targetPos;
    events.push({ type: 'player_moved', player: player.id, from: oldPos, to: targetPos });
    this._landOnSquare(player, targetPos, events);
  }

  // ── Land on square ─────────────────────────────────────────
  _landOnSquare(player, pos, events) {
    const sq   = BOARD[pos];
    const prop = this.state.properties[pos];

    switch (sq.type) {
      case 'go':
        break;

      case 'go_to_jail':
        this._sendToJail(player, events);
        break;

      case 'jail':
        events.push({ type: 'just_visiting', player: player.id });
        break;

      case 'free_parking':
        if (this.state.freeParkingMoney > 0) {
          const amt = this.state.freeParkingMoney;
          this._addMoney(player, amt, events);
          this.state.freeParkingMoney = 0;
          events.push({ type: 'free_parking_collect', player: player.id, amount: amt });
          this._log(events, `${player.name} собрал $${amt} с бесплатной парковки!`);
        }
        break;

      case 'tax':
        this._payTax(player, sq, events);
        break;

      case 'chance':
        this._drawChance(player, events);
        break;

      case 'community_chest':
        this._drawCommunity(player, events);
        break;

      case 'property':
      case 'station':
      case 'utility':
        if (!prop || prop.owner === null) {
          // Unowned — offer to buy
          if (player.money >= sq.price) {
            this.state.pendingAction = {
              type: 'buy_offer',
              squareId: pos,
              player: player.id,
              price: sq.price,
            };
            events.push({ type: 'buy_offer', player: player.id, squareId: pos, price: sq.price });
          } else {
            // Can't afford — auction
            this._startAuction(sq, events);
          }
        } else if (prop.owner !== player.id && !prop.mortgaged) {
          // Pay rent
          const diceTotal = this.state.dice[0] + this.state.dice[1];
          const rent = calculateRent(pos, diceTotal, this.state.properties, this.state.players);
          if (rent > 0) {
            const owner = this.state.players.find(p => p.id === prop.owner);
            this._transferMoney(player, owner, rent, events);
            events.push({ type: 'rent_paid', payer: player.id, receiver: prop.owner, amount: rent, squareId: pos });
            this._log(events, `${player.name} платит аренду $${rent} → ${owner.name}`);
            this._checkBankruptcy(player, events);
          }
        }
        break;
    }
  }

  // ── Buy property ───────────────────────────────────────────
  _buyProperty(events, squareId) {
    const st   = this.state;
    const cur  = this.currentPlayer;
    const sq   = BOARD[squareId];
    const prop = st.properties[squareId];

    if (!prop || prop.owner !== null) return { ok: false, error: 'Уже куплена' };
    if (cur.money < sq.price) return { ok: false, error: 'Недостаточно денег' };

    this._deductMoney(cur, sq.price, events);
    prop.owner = cur.id;
    st.pendingAction = null;

    events.push({ type: 'property_bought', player: cur.id, squareId, price: sq.price });
    this._log(events, `${cur.name} купил ${sq.name} за $${sq.price}`);

    return this._result(events);
  }

  // ── Auction ────────────────────────────────────────────────
  _startAuction(sq, events) {
    const bidders = this.activePlayers.map(p => ({ id: p.id, passed: false }));
    this.state.pendingAction = {
      type: 'auction',
      squareId: sq.id,
      price: sq.price,
      currentBid: 1,
      highestBidder: null,
      bidders,
      bidderIdx: 0,
    };
    events.push({ type: 'auction_start', squareId: sq.id, startBid: 1, bidders });
    this._log(events, `Аукцион начат: ${sq.name}`);
  }

  _auctionBid(events, peerId, amount) {
    const pa  = this.state.pendingAction;
    if (!pa || pa.type !== 'auction') return { ok: false, error: 'Нет аукциона' };

    const bidder = pa.bidders[pa.bidderIdx];
    const player = this.state.players.find(p => p.peerId === peerId);
    if (!player || bidder.id !== player.id) return { ok: false, error: 'Не ваша очередь' };
    if (amount <= pa.currentBid) return { ok: false, error: 'Ставка слишком мала' };
    if (player.money < amount) return { ok: false, error: 'Недостаточно денег' };

    pa.currentBid    = amount;
    pa.highestBidder = player.id;
    events.push({ type: 'auction_bid', player: player.id, amount });
    this._log(events, `${player.name} ставит $${amount}`);

    this._nextAuctionBidder(events);
    return this._result(events);
  }

  _auctionPass(events, peerId) {
    const pa  = this.state.pendingAction;
    if (!pa || pa.type !== 'auction') return { ok: false, error: 'Нет аукциона' };

    const player = this.state.players.find(p => p.peerId === peerId);
    const bidder = pa.bidders[pa.bidderIdx];
    if (!player || bidder.id !== player.id) return { ok: false, error: 'Не ваша очередь' };

    bidder.passed = true;
    events.push({ type: 'auction_pass', player: player.id });

    this._nextAuctionBidder(events);
    return this._result(events);
  }

  _nextAuctionBidder(events) {
    const pa     = this.state.pendingAction;
    const active = pa.bidders.filter(b => !b.passed);
    if (active.length <= 1) {
      // Auction ends
      if (pa.highestBidder) {
        const winner = this.state.players.find(p => p.id === pa.highestBidder);
        this._deductMoney(winner, pa.currentBid, events);
        this.state.properties[pa.squareId].owner = winner.id;
        events.push({ type: 'auction_won', player: winner.id, squareId: pa.squareId, price: pa.currentBid });
        this._log(events, `${winner.name} выиграл аукцион! Купил ${BOARD[pa.squareId].name} за $${pa.currentBid}`);
      } else {
        events.push({ type: 'auction_no_winner', squareId: pa.squareId });
        this._log(events, 'Никто не купил на аукционе.');
      }
      this.state.pendingAction = null;
    } else {
      // Next bidder
      do {
        pa.bidderIdx = (pa.bidderIdx + 1) % pa.bidders.length;
      } while (pa.bidders[pa.bidderIdx].passed);
      events.push({ type: 'auction_next', bidderId: pa.bidders[pa.bidderIdx].id });
    }
  }

  // ── Tax ────────────────────────────────────────────────────
  _payTax(player, sq, events) {
    const amount = sq.amount;
    this._deductMoney(player, amount, events);
    this.state.freeParkingMoney += amount;
    events.push({ type: 'tax_paid', player: player.id, amount });
    this._log(events, `${player.name} заплатил налог $${amount}`);
    this._checkBankruptcy(player, events);
  }

  // ── Cards ──────────────────────────────────────────────────
  _drawChance(player, events) {
    const card = this._chanceDeck[this._chanceIdx % this._chanceDeck.length];
    this._chanceIdx++;
    events.push({ type: 'card_drawn', deck: 'chance', card });
    this._log(events, `Шанс: ${card.text}`);
    this._applyCard(player, card, events);
  }

  _drawCommunity(player, events) {
    const card = this._commDeck[this._commIdx % this._commDeck.length];
    this._commIdx++;
    events.push({ type: 'card_drawn', deck: 'community', card });
    this._log(events, `Казна: ${card.text}`);
    this._applyCard(player, card, events);
  }

  _applyCard(player, card, events) {
    switch (card.action) {
      case 'move_to':
        this._movePlayerTo(player, card.target, events, true);
        break;
      case 'move_back':
        player.position = (player.position - card.amount + 40) % 40;
        events.push({ type: 'player_moved', player: player.id, to: player.position });
        this._landOnSquare(player, player.position, events);
        break;
      case 'go_to_jail':
        this._sendToJail(player, events);
        break;
      case 'receive':
        this._addMoney(player, card.amount, events);
        break;
      case 'pay':
        this._deductMoney(player, card.amount, events);
        this.state.freeParkingMoney += card.amount;
        this._checkBankruptcy(player, events);
        break;
      case 'pay_each': {
        const others = this.activePlayers.filter(p => p.id !== player.id);
        others.forEach(other => {
          this._transferMoney(player, other, card.amount, events);
        });
        this._checkBankruptcy(player, events);
        break;
      }
      case 'collect_each': {
        const others = this.activePlayers.filter(p => p.id !== player.id);
        others.forEach(other => {
          this._transferMoney(other, player, card.amount, events);
        });
        break;
      }
      case 'get_out_of_jail':
        player.getOutOfJailCards++;
        events.push({ type: 'got_jail_card', player: player.id });
        break;
      case 'repair': {
        let cost = 0;
        Object.entries(this.state.properties).forEach(([id, prop]) => {
          if (prop.owner === player.id) {
            if (prop.hotel)        cost += card.hotel;
            else                   cost += prop.houses * card.house;
          }
        });
        this._deductMoney(player, cost, events);
        this.state.freeParkingMoney += cost;
        events.push({ type: 'repair_cost', player: player.id, amount: cost });
        this._checkBankruptcy(player, events);
        break;
      }
      case 'nearest_station': {
        const stations = [5, 15, 25, 35];
        const nearest  = this._findNearest(player.position, stations);
        const prop      = this.state.properties[nearest];
        if (!prop || prop.owner === null) {
          this._movePlayerTo(player, nearest, events, true);
        } else {
          player.position = nearest;
          const owner = this.state.players.find(p => p.id === prop.owner);
          const rent  = calculateRent(nearest, this.state.dice[0]+this.state.dice[1], this.state.properties, this.state.players) * 2;
          this._transferMoney(player, owner, rent, events);
          this._log(events, `${player.name} платит двойную аренду за станцию $${rent}`);
        }
        break;
      }
      case 'nearest_utility': {
        const utils   = [12];
        const nearest = this._findNearest(player.position, utils);
        const prop     = this.state.properties[nearest];
        if (!prop || prop.owner === null) {
          this._movePlayerTo(player, nearest, events, true);
        } else {
          const diceTotal = this.state.dice[0] + this.state.dice[1];
          const owner = this.state.players.find(p => p.id === prop.owner);
          const rent  = diceTotal * 10;
          this._transferMoney(player, owner, rent, events);
          this._log(events, `${player.name} платит 10×${diceTotal}=$${rent} за коммунальную службу`);
        }
        break;
      }
    }
  }

  _findNearest(pos, targets) {
    let best = targets[0], bestDist = 99;
    targets.forEach(t => {
      const dist = (t - pos + 40) % 40;
      if (dist < bestDist) { bestDist = dist; best = t; }
    });
    return best;
  }

  // ── Jail ───────────────────────────────────────────────────
  _sendToJail(player, events) {
    player.position     = CONFIG.jailPosition;
    player.inJail       = true;
    player.jailTurns    = 0;
    player.doublesCount = 0;
    events.push({ type: 'sent_to_jail', player: player.id });
    this._log(events, `${player.name} отправлен в тюрьму!`);
  }

  _jailPay(events) {
    const cur = this.currentPlayer;
    if (!cur.inJail) return { ok: false, error: 'Не в тюрьме' };
    if (cur.money < CONFIG.jailFine) return { ok: false, error: 'Недостаточно денег' };
    this._deductMoney(cur, CONFIG.jailFine, events);
    cur.inJail    = false;
    cur.jailTurns = 0;
    events.push({ type: 'jail_paid', player: cur.id });
    this._log(events, `${cur.name} заплатил $${CONFIG.jailFine} и вышел из тюрьмы`);
    return this._result(events);
  }

  _jailCard(events) {
    const cur = this.currentPlayer;
    if (!cur.inJail) return { ok: false, error: 'Не в тюрьме' };
    if (cur.getOutOfJailCards <= 0) return { ok: false, error: 'Нет карточки' };
    cur.getOutOfJailCards--;
    cur.inJail    = false;
    cur.jailTurns = 0;
    events.push({ type: 'jail_card_used', player: cur.id });
    this._log(events, `${cur.name} использовал карточку выхода из тюрьмы`);
    return this._result(events);
  }

  // ── Build / Sell houses & hotels ───────────────────────────
  _buildHouse(events, squareId, sell = false) {
    const cur  = this.currentPlayer;
    const sq   = BOARD[squareId];
    const prop = this.state.properties[squareId];

    if (!prop || prop.owner !== cur.id) return { ok: false, error: 'Не ваша собственность' };
    if (sq.type !== 'property') return { ok: false, error: 'Нельзя строить здесь' };
    if (prop.mortgaged) return { ok: false, error: 'Заложено' };

    // Must own full group
    const group = BOARD.filter(s => s.type === 'property' && s.group === sq.group);
    const ownsAll = group.every(s => this.state.properties[s.id]?.owner === cur.id);
    if (!ownsAll) return { ok: false, error: 'Нужно владеть всей группой' };

    if (sell) {
      // Sell house
      if (prop.hotel) {
        if (this.state.houseBank < 4) return { ok: false, error: 'Нет домов в банке' };
        prop.hotel = false;
        prop.houses = 4;
        this.state.hotelBank++;
        this.state.houseBank -= 4;
        this._addMoney(cur, Math.floor(sq.buildCost / 2), events);
        events.push({ type: 'hotel_sold', player: cur.id, squareId });
      } else if (prop.houses > 0) {
        // Evenness: can't sell below lowest in group
        const minHouses = Math.min(...group.map(s => {
          const p = this.state.properties[s.id];
          return p.hotel ? 5 : p.houses;
        }));
        if (prop.hotel ? 5 : prop.houses <= minHouses - 1)
          return { ok: false, error: 'Нужно продавать равномерно' };
        prop.houses--;
        this.state.houseBank++;
        this._addMoney(cur, Math.floor(sq.buildCost / 2), events);
        events.push({ type: 'house_sold', player: cur.id, squareId, houses: prop.houses });
      } else {
        return { ok: false, error: 'Нечего продавать' };
      }
    } else {
      // Build house/hotel
      const maxLevel = Math.max(...group.map(s => {
        const p = this.state.properties[s.id];
        return p.hotel ? 5 : p.houses;
      }));
      const curLevel = prop.hotel ? 5 : prop.houses;
      if (curLevel >= maxLevel + 1 && !prop.hotel)
        return { ok: false, error: 'Стройте равномерно' };

      if (cur.money < sq.buildCost) return { ok: false, error: 'Недостаточно денег' };

      if (prop.houses === 4) {
        // Upgrade to hotel
        if (this.state.hotelBank <= 0) return { ok: false, error: 'В банке нет отелей' };
        prop.hotel  = true;
        prop.houses = 0;
        this.state.houseBank += 4;
        this.state.hotelBank--;
        this._deductMoney(cur, sq.buildCost, events);
        events.push({ type: 'hotel_built', player: cur.id, squareId });
        this._log(events, `${cur.name} построил отель на ${sq.name}`);
      } else {
        if (this.state.houseBank <= 0) return { ok: false, error: 'В банке нет домов' };
        prop.houses++;
        this.state.houseBank--;
        this._deductMoney(cur, sq.buildCost, events);
        events.push({ type: 'house_built', player: cur.id, squareId, houses: prop.houses });
        this._log(events, `${cur.name} построил ${prop.houses} дом(а) на ${sq.name}`);
      }
    }
    return this._result(events);
  }

  // ── Mortgage ───────────────────────────────────────────────
  _mortgage(events, squareId, redeem = false) {
    const cur  = this.currentPlayer;
    const sq   = BOARD[squareId];
    const prop = this.state.properties[squareId];
    if (!prop || prop.owner !== cur.id) return { ok: false, error: 'Не ваша собственность' };

    if (redeem) {
      const cost = Math.floor(sq.mortgage * 1.1);
      if (cur.money < cost) return { ok: false, error: 'Недостаточно денег' };
      if (!prop.mortgaged) return { ok: false, error: 'Не заложено' };
      prop.mortgaged = false;
      this._deductMoney(cur, cost, events);
      events.push({ type: 'property_redeemed', player: cur.id, squareId });
      this._log(events, `${cur.name} выкупил ${sq.name} за $${cost}`);
    } else {
      if (prop.mortgaged) return { ok: false, error: 'Уже заложено' };
      if (prop.houses > 0 || prop.hotel) return { ok: false, error: 'Сначала продайте постройки' };
      prop.mortgaged = true;
      this._addMoney(cur, sq.mortgage, events);
      events.push({ type: 'property_mortgaged', player: cur.id, squareId });
      this._log(events, `${cur.name} заложил ${sq.name} за $${sq.mortgage}`);
    }
    return this._result(events);
  }

  // ── Trade ──────────────────────────────────────────────────
  _tradeOffer(events, fromPeerId, trade) {
    const from = this.state.players.find(p => p.peerId === fromPeerId);
    if (!from) return { ok: false, error: 'Игрок не найден' };
    const tradeId = Math.random().toString(36).substr(2, 8);
    this.state.pendingAction = {
      type: 'trade',
      id: tradeId,
      from: from.id,
      to: trade.to,
      offer: trade.offer,   // { money, properties }
      request: trade.request, // { money, properties }
    };
    events.push({ type: 'trade_offered', tradeId, from: from.id, trade });
    this._log(events, `${from.name} предлагает сделку`);
    return this._result(events);
  }

  _tradeAccept(events, tradeId) {
    const pa = this.state.pendingAction;
    if (!pa || pa.type !== 'trade' || pa.id !== tradeId) return { ok: false, error: 'Сделка не найдена' };

    const from = this.state.players.find(p => p.id === pa.from);
    const to   = this.state.players.find(p => p.id === pa.to);
    if (!from || !to) return { ok: false, error: 'Игрок не найден' };

    // Transfer money
    if (pa.offer.money > 0) this._transferMoney(from, to, pa.offer.money, events);
    if (pa.request.money > 0) this._transferMoney(to, from, pa.request.money, events);

    // Transfer properties
    (pa.offer.properties || []).forEach(sqId => {
      if (this.state.properties[sqId]) this.state.properties[sqId].owner = to.id;
    });
    (pa.request.properties || []).forEach(sqId => {
      if (this.state.properties[sqId]) this.state.properties[sqId].owner = from.id;
    });

    this.state.pendingAction = null;
    events.push({ type: 'trade_completed', tradeId });
    this._log(events, `Сделка между ${from.name} и ${to.name} завершена!`);
    return this._result(events);
  }

  _tradeReject(events, tradeId) {
    const pa = this.state.pendingAction;
    if (!pa || pa.type !== 'trade' || pa.id !== tradeId) return { ok: false, error: 'Сделка не найдена' };
    const from = this.state.players.find(p => p.id === pa.from);
    this.state.pendingAction = null;
    events.push({ type: 'trade_rejected', tradeId });
    this._log(events, `Сделка ${from.name} отклонена`);
    return this._result(events);
  }

  // ── End turn ───────────────────────────────────────────────
  _endTurn(events) {
    const st  = this.state;
    const cur = this.currentPlayer;

    if (!st.diceRolled) return { ok: false, error: 'Сначала бросьте кубики' };
    if (st.pendingAction && st.pendingAction.type === 'buy_offer') {
      // Player chose not to buy → auction or pass
      if (this.settings.auctionMode) {
        this._startAuction(BOARD[st.pendingAction.squareId], events);
      }
      st.pendingAction = null;
    }
    if (st.pendingAction) return { ok: false, error: 'Завершите действие' };

    this._endTurnAuto(events);
    return this._result(events);
  }

  _endTurnAuto(events) {
    const st = this.state;
    // If doubles (and not in jail), same player goes again
    if (st.diceDouble && !this.currentPlayer.inJail && !this.currentPlayer.isBankrupt) {
      st.diceRolled = false;
      events.push({ type: 'doubles_again', player: this.currentPlayer.id });
      this._log(events, `${this.currentPlayer.name} снова бросает (дубль)!`);
    } else {
      // Next player
      this.currentPlayer.doublesCount = 0;
      let next = (st.currentPlayerIdx + 1) % st.players.length;
      while (st.players[next].isBankrupt) {
        next = (next + 1) % st.players.length;
      }
      st.currentPlayerIdx = next;
      st.diceRolled       = false;
      st.diceDouble       = false;
      st.turnCount++;
      events.push({ type: 'turn_changed', player: st.players[next].id });
      this._log(events, `Ход переходит к ${st.players[next].name}`);
      this._checkWinCondition(events);
    }
  }

  // ── Bankruptcy ─────────────────────────────────────────────
  _checkBankruptcy(player, events) {
    if (player.money < 0) {
      // Can they sell/mortgage to cover?
      const liquidatable = Object.entries(this.state.properties)
        .filter(([id, p]) => p.owner === player.id)
        .reduce((sum, [id, p]) => {
          const sq = BOARD[parseInt(id)];
          return sum + (p.mortgaged ? 0 : sq.mortgage);
        }, 0);
      if (player.money + liquidatable < 0) {
        events.push({ type: 'bankrupt_warning', player: player.id });
      }
    }
  }

  _declareBankrupt(events) {
    const cur = this.currentPlayer;
    cur.isBankrupt = true;
    // Return all properties to bank
    Object.entries(this.state.properties).forEach(([id, prop]) => {
      if (prop.owner === cur.id) {
        prop.owner     = null;
        prop.houses    = 0;
        prop.hotel     = false;
        prop.mortgaged = false;
        this.state.houseBank += prop.houses;
        this.state.hotelBank += prop.hotel ? 1 : 0;
      }
    });
    events.push({ type: 'bankrupt', player: cur.id });
    this._log(events, `${cur.name} объявил банкротство!`);
    this._checkWinCondition(events);
    this._endTurnAuto(events);
    return this._result(events);
  }

  // ── Win condition ──────────────────────────────────────────
  _checkWinCondition(events) {
    const active = this.activePlayers;
    if (active.length === 1) {
      this.state.phase = 'ended';
      const winner = active[0];
      events.push({ type: 'game_over', winner: winner.id, name: winner.name });
      this._log(events, `ПОБЕДИТЕЛЬ: ${winner.name}!`);
    }
    // Team win condition
    if (this.settings.teamMode && active.length > 1) {
      const teams = {};
      active.forEach(p => {
        if (p.team !== null) teams[p.team] = (teams[p.team] || 0) + 1;
      });
      const remainingTeams = Object.keys(teams);
      if (remainingTeams.length === 1) {
        this.state.phase = 'ended';
        events.push({ type: 'game_over', winnerTeam: parseInt(remainingTeams[0]) });
      }
    }
  }

  // ── Money helpers ──────────────────────────────────────────
  _addMoney(player, amount, events) {
    player.money += amount;
    events.push({ type: 'money_changed', player: player.id, amount: +amount, balance: player.money });
  }

  _deductMoney(player, amount, events) {
    player.money -= amount;
    events.push({ type: 'money_changed', player: player.id, amount: -amount, balance: player.money });
  }

  _transferMoney(from, to, amount, events) {
    const actual = Math.min(amount, from.money + 0); // allow go negative
    from.money -= actual;
    to.money   += actual;
    events.push({ type: 'money_transferred', from: from.id, to: to.id, amount: actual });
  }

  // ── Log / Result ───────────────────────────────────────────
  _log(events, msg) {
    this.state.log.unshift({ msg, time: Date.now() });
    if (this.state.log.length > 50) this.state.log.pop();
    events.push({ type: 'log', msg });
  }

  _result(events) {
    return { ok: true, events, state: this.getPublicState() };
  }

  getPublicState() {
    // Return a copy of the state (deep-ish)
    return JSON.parse(JSON.stringify(this.state));
  }
}
