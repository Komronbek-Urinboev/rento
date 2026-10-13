// ============================================================
// МОНОПОЛИЯ МИР — Game Configuration
// ============================================================

const CONFIG = {
  startMoney: 2000,
  goSalary: 200,
  jailFine: 50,
  maxHouses: 32,
  maxHotels: 12,
  maxPlayers: 6,
  jailPosition: 10,
  jailMaxTurns: 3,
};

// Property color groups
const GROUPS = {
  0: { color: '#8B4513', bg: '#C49A6C', name: 'Коричневый',  housePrice: 50  },
  1: { color: '#5BB8D4', bg: '#A8DFF0', name: 'Голубой',     housePrice: 50  },
  2: { color: '#C2185B', bg: '#F48FB1', name: 'Розовый',     housePrice: 100 },
  3: { color: '#E65100', bg: '#FFCC80', name: 'Оранжевый',   housePrice: 100 },
  4: { color: '#C62828', bg: '#EF9A9A', name: 'Красный',     housePrice: 150 },
  5: { color: '#F9A825', bg: '#FFF59D', name: 'Жёлтый',      housePrice: 150 },
  6: { color: '#2E7D32', bg: '#A5D6A7', name: 'Зелёный',     housePrice: 200 },
  7: { color: '#1565C0', bg: '#90CAF9', name: 'Тёмно-синий', housePrice: 200 },
};

// Player token colors/shapes
const PLAYER_TOKENS = [
  { id: 0, name: 'Красный',     color: '#E53935', dark: '#B71C1C' },
  { id: 1, name: 'Синий',       color: '#1E88E5', dark: '#0D47A1' },
  { id: 2, name: 'Зелёный',     color: '#43A047', dark: '#1B5E20' },
  { id: 3, name: 'Жёлтый',      color: '#FDD835', dark: '#F57F17' },
  { id: 4, name: 'Фиолетовый',  color: '#8E24AA', dark: '#4A148C' },
  { id: 5, name: 'Оранжевый',   color: '#FB8C00', dark: '#E65100' },
];

// ============================================================
// BOARD SQUARES — 40 positions, clockwise from GO
// GO is at bottom-right corner (position 0)
// Jail at bottom-left (position 10)
// Free Parking at top-left (position 20)
// Go-To-Jail at top-right (position 30)
// ============================================================
const BOARD = [
  // ── BOTTOM ROW: right → left (positions 0–10) ──────────
  {
    id: 0, type: 'go',
    name: 'СТАРТ', sub: 'Получите $200',
  },
  {
    id: 1, type: 'property', group: 0,
    name: 'Болгария', flag: '🇧🇬',
    price: 60, mortgage: 30, buildCost: 50,
    rent: [2, 10, 30, 90, 160, 250],
  },
  {
    id: 2, type: 'community_chest',
    name: 'Общая\nКазна',
  },
  {
    id: 3, type: 'property', group: 0,
    name: 'Греция', flag: '🇬🇷',
    price: 60, mortgage: 30, buildCost: 50,
    rent: [4, 20, 60, 180, 320, 450],
  },
  {
    id: 4, type: 'tax',
    name: 'Подоходный\nНалог', amount: 200,
  },
  {
    id: 5, type: 'station',
    name: 'Станция\nЯпония',
    price: 200, mortgage: 100,
    rent: [25, 50, 100, 200],
  },
  {
    id: 6, type: 'property', group: 1,
    name: 'Турция', flag: '🇹🇷',
    price: 100, mortgage: 50, buildCost: 50,
    rent: [6, 30, 90, 270, 400, 550],
  },
  {
    id: 7, type: 'chance',
    name: 'Шанс',
  },
  {
    id: 8, type: 'property', group: 1,
    name: 'Ливия', flag: '🇱🇾',
    price: 100, mortgage: 50, buildCost: 50,
    rent: [6, 30, 90, 270, 400, 550],
  },
  {
    id: 9, type: 'property', group: 1,
    name: 'Сур', flag: '🇴🇲',
    price: 120, mortgage: 60, buildCost: 50,
    rent: [8, 40, 100, 300, 450, 600],
  },
  {
    id: 10, type: 'jail',
    name: 'Тюрьма', sub: 'Просто посещение',
  },

  // ── LEFT COLUMN: bottom → top (positions 11–19) ─────────
  {
    id: 11, type: 'property', group: 2,
    name: 'Польша', flag: '🇵🇱',
    price: 140, mortgage: 70, buildCost: 100,
    rent: [10, 50, 150, 450, 625, 750],
  },
  {
    id: 12, type: 'utility',
    name: 'Электро\nКомпания',
    price: 150, mortgage: 75,
  },
  {
    id: 13, type: 'property', group: 2,
    name: 'Россия', flag: '🇷🇺',
    price: 140, mortgage: 70, buildCost: 100,
    rent: [10, 50, 150, 450, 625, 750],
  },
  {
    id: 14, type: 'property', group: 2,
    name: 'Украина', flag: '🇺🇦',
    price: 160, mortgage: 80, buildCost: 100,
    rent: [12, 60, 180, 500, 700, 900],
  },
  {
    id: 15, type: 'station',
    name: 'Ст.\nИспания',
    price: 200, mortgage: 100,
    rent: [25, 50, 100, 200],
  },
  {
    id: 16, type: 'property', group: 3,
    name: 'Ватикан', flag: '🇻🇦',
    price: 180, mortgage: 90, buildCost: 100,
    rent: [14, 70, 200, 550, 750, 950],
  },
  {
    id: 17, type: 'community_chest',
    name: 'Общая\nКазна',
  },
  {
    id: 18, type: 'property', group: 3,
    name: 'Литва', flag: '🇱🇹',
    price: 180, mortgage: 90, buildCost: 100,
    rent: [14, 70, 200, 550, 750, 950],
  },
  {
    id: 19, type: 'property', group: 3,
    name: 'Латвия', flag: '🇱🇻',
    price: 200, mortgage: 100, buildCost: 100,
    rent: [16, 80, 220, 600, 800, 1000],
  },

  // ── TOP ROW: left → right (positions 20–30) ─────────────
  {
    id: 20, type: 'free_parking',
    name: 'Бесплатная\nПарковка',
  },
  {
    id: 21, type: 'property', group: 4,
    name: 'Эстония', flag: '🇪🇪',
    price: 220, mortgage: 110, buildCost: 150,
    rent: [18, 90, 250, 700, 875, 1050],
  },
  {
    id: 22, type: 'chance',
    name: 'Шанс',
  },
  {
    id: 23, type: 'property', group: 4,
    name: 'Норвегия', flag: '🇳🇴',
    price: 220, mortgage: 110, buildCost: 150,
    rent: [18, 90, 250, 700, 875, 1050],
  },
  {
    id: 24, type: 'property', group: 4,
    name: 'Швеция', flag: '🇸🇪',
    price: 240, mortgage: 120, buildCost: 150,
    rent: [20, 100, 300, 750, 925, 1100],
  },
  {
    id: 25, type: 'station',
    name: 'Станция\nСША',
    price: 200, mortgage: 100,
    rent: [25, 50, 100, 200],
  },
  {
    id: 26, type: 'property', group: 5,
    name: 'Финляндия', flag: '🇫🇮',
    price: 260, mortgage: 130, buildCost: 150,
    rent: [22, 110, 330, 800, 975, 1150],
  },
  {
    id: 27, type: 'property', group: 5,
    name: 'Германия', flag: '🇩🇪',
    price: 260, mortgage: 130, buildCost: 150,
    rent: [22, 110, 330, 800, 975, 1150],
  },
  {
    id: 28, type: 'tax',
    name: 'Налог на\nРоскошь', amount: 100,
  },
  {
    id: 29, type: 'property', group: 5,
    name: 'Франция', flag: '🇫🇷',
    price: 280, mortgage: 140, buildCost: 150,
    rent: [24, 120, 360, 850, 1025, 1200],
  },
  {
    id: 30, type: 'go_to_jail',
    name: 'Идти в\nТюрьму',
  },

  // ── RIGHT COLUMN: top → bottom (positions 31–39) ────────
  {
    id: 31, type: 'property', group: 6,
    name: 'В. Британия', flag: '🇬🇧',
    price: 300, mortgage: 150, buildCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275],
  },
  {
    id: 32, type: 'property', group: 6,
    name: 'Канада', flag: '🇨🇦',
    price: 300, mortgage: 150, buildCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275],
  },
  {
    id: 33, type: 'community_chest',
    name: 'Общая\nКазна',
  },
  {
    id: 34, type: 'property', group: 6,
    name: 'Мексика', flag: '🇲🇽',
    price: 320, mortgage: 160, buildCost: 200,
    rent: [28, 150, 450, 1000, 1200, 1400],
  },
  {
    id: 35, type: 'station',
    name: 'Станция\nUK',
    price: 200, mortgage: 100,
    rent: [25, 50, 100, 200],
  },
  {
    id: 36, type: 'chance',
    name: 'Шанс',
  },
  {
    id: 37, type: 'property', group: 7,
    name: 'США', flag: '🇺🇸',
    price: 350, mortgage: 175, buildCost: 200,
    rent: [35, 175, 500, 1100, 1300, 1500],
  },
  {
    id: 38, type: 'tax',
    name: 'Налог на\nСтоянку', amount: 75,
  },
  {
    id: 39, type: 'property', group: 7,
    name: 'Китай', flag: '🇨🇳',
    price: 400, mortgage: 200, buildCost: 200,
    rent: [50, 200, 600, 1400, 1700, 2000],
  },
];

// ── Grid position helper ─────────────────────────────────────
// Returns {row, col} in an 11×11 CSS grid (1-indexed)
// GO = row 11 col 11 (bottom-right), going clockwise
function getGridPos(pos) {
  if (pos === 0)  return { row: 11, col: 11 };
  if (pos <= 9)   return { row: 11, col: 11 - pos };
  if (pos === 10) return { row: 11, col: 1  };
  if (pos <= 19)  return { row: 21 - pos, col: 1  };
  if (pos === 20) return { row: 1,  col: 1  };
  if (pos <= 29)  return { row: 1,  col: pos - 19 };
  if (pos === 30) return { row: 1,  col: 11 };
  if (pos <= 39)  return { row: pos - 29, col: 11 };
  return { row: 11, col: 11 };
}

// Which side of the board (for text rotation)
function getBoardSide(pos) {
  if (pos === 0 || pos === 10 || pos === 20 || pos === 30) return 'corner';
  if (pos >= 1  && pos <= 9)  return 'bottom';
  if (pos >= 11 && pos <= 19) return 'left';
  if (pos >= 21 && pos <= 29) return 'top';
  if (pos >= 31 && pos <= 39) return 'right';
}

// Count how many stations/utilities a player owns
function countOwned(playerId, type, properties) {
  return BOARD.filter(sq => sq.type === type &&
    properties[sq.id] && properties[sq.id].owner === playerId).length;
}

// Calculate rent for a given square
function calculateRent(squareId, diceTotal, properties, players) {
  const sq = BOARD[squareId];
  const prop = properties[squareId];
  if (!prop || prop.owner === null || prop.mortgaged) return 0;

  if (sq.type === 'station') {
    const owned = countOwned(prop.owner, 'station', properties);
    return sq.rent[owned - 1];
  }

  if (sq.type === 'utility') {
    const owned = countOwned(prop.owner, 'utility', properties);
    return diceTotal * (owned === 1 ? 4 : 10);
  }

  if (sq.type === 'property') {
    if (prop.hotel) return sq.rent[5];
    if (prop.houses > 0) return sq.rent[prop.houses];
    // Check if owner has full color group (double rent with no houses)
    const groupSquares = BOARD.filter(s => s.type === 'property' && s.group === sq.group);
    const ownsAll = groupSquares.every(s =>
      properties[s.id] && properties[s.id].owner === prop.owner && !properties[s.id].mortgaged);
    return ownsAll ? sq.rent[0] * 2 : sq.rent[0];
  }

  return 0;
}

// ── Chance cards ─────────────────────────────────────────────
const CHANCE_CARDS = [
  { id: 'ch1',  text: 'Перейдите на СТАРТ! Получите $200.',  action: 'move_to', target: 0 },
  { id: 'ch2',  text: 'Переходите в тюрьму. Не проходите СТАРТ, не получайте $200.', action: 'go_to_jail' },
  { id: 'ch3',  text: 'Пройдите на 3 клетки назад.',         action: 'move_back', amount: 3 },
  { id: 'ch4',  text: 'Штраф дорожной полиции $15.',          action: 'pay', amount: 15 },
  { id: 'ch5',  text: 'Банк выплачивает вам дивиденды $50.',  action: 'receive', amount: 50 },
  { id: 'ch6',  text: 'Вы избраны председателем совета. Заплатите каждому игроку $50.', action: 'pay_each', amount: 50 },
  { id: 'ch7',  text: 'Ваш кредит на строительство погашен. Получите $150.',            action: 'receive', amount: 150 },
  { id: 'ch8',  text: 'Вы выиграли в кроссворде. Получите $100.',                       action: 'receive', amount: 100 },
  { id: 'ch9',  text: 'Карточка "Выйти из тюрьмы". Сохраните её до нужного момента.',   action: 'get_out_of_jail' },
  { id: 'ch10', text: 'Ремонт домов: $25 за дом, $100 за отель.',    action: 'repair', house: 25, hotel: 100 },
  { id: 'ch11', text: 'Перейдите к ближайшей станции. Если она не куплена — купите. Иначе платите двойную аренду.', action: 'nearest_station' },
  { id: 'ch12', text: 'Перейдите к ближайшей коммунальной компании. Если не куплена — купите, иначе заплатите 10× кубики.', action: 'nearest_utility' },
  { id: 'ch13', text: 'Перейдите в Германию. Если проходите СТАРТ — получите $200.',    action: 'move_to', target: 27 },
  { id: 'ch14', text: 'Перейдите в Францию. Если проходите СТАРТ — получите $200.',     action: 'move_to', target: 29 },
  { id: 'ch15', text: 'Перейдите в Китай. Если проходите СТАРТ — получите $200.',       action: 'move_to', target: 39 },
  { id: 'ch16', text: 'Перейдите на СТАРТ! Получите $200.',           action: 'move_to', target: 0 },
];

const COMMUNITY_CARDS = [
  { id: 'cc1',  text: 'Перейдите на СТАРТ! Получите $200.',             action: 'move_to', target: 0 },
  { id: 'cc2',  text: 'Ошибка банка в вашу пользу. Получите $200.',     action: 'receive', amount: 200 },
  { id: 'cc3',  text: 'Счёт врача. Заплатите $50.',                     action: 'pay', amount: 50 },
  { id: 'cc4',  text: 'С продажи акций. Получите $50.',                 action: 'receive', amount: 50 },
  { id: 'cc5',  text: 'Карточка "Выйти из тюрьмы". Сохраните до нужного момента.', action: 'get_out_of_jail' },
  { id: 'cc6',  text: 'Переходите в тюрьму. Не проходите СТАРТ, не получайте $200.', action: 'go_to_jail' },
  { id: 'cc7',  text: 'Грандиозный вечер оперы! Получите $50 с каждого игрока.', action: 'collect_each', amount: 50 },
  { id: 'cc8',  text: 'Ваш праздничный фонд созрел. Получите $100.',    action: 'receive', amount: 100 },
  { id: 'cc9',  text: 'Налоговый возврат дохода. Получите $20.',        action: 'receive', amount: 20 },
  { id: 'cc10', text: 'Ваш день рождения! Получите $10 от каждого игрока.', action: 'collect_each', amount: 10 },
  { id: 'cc11', text: 'Страховка по жизни созрела. Получите $100.',     action: 'receive', amount: 100 },
  { id: 'cc12', text: 'Оплата больничных. Заплатите $100.',             action: 'pay', amount: 100 },
  { id: 'cc13', text: 'Школьный сбор. Заплатите $150.',                 action: 'pay', amount: 150 },
  { id: 'cc14', text: 'Получите $25 в качестве консультанта.',          action: 'receive', amount: 25 },
  { id: 'cc15', text: 'Ремонт улиц: $40 за дом, $115 за отель.',        action: 'repair', house: 40, hotel: 115 },
  { id: 'cc16', text: 'Вы получили второй приз в конкурсе красоты. Получите $10.', action: 'receive', amount: 10 },
];
