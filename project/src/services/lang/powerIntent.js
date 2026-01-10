function normalizeText(text = '') {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesKeyword(text = '', keyword = '') {
  if (!keyword) return false;
  if (/[\u0600-\u06FF]/.test(keyword)) {
    return text.includes(keyword);
  }
  if (keyword.length <= 2) {
    return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
  }
  return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i').test(text);
}

function containsAnyKeyword(text = '', keywords = []) {
  return keywords.some((keyword) => includesKeyword(text, keyword));
}

const TV_KEYWORDS = [
  'tv',
  'television',
  'tele',
  'tlfaz',
  'telfaz',
  'telfaza',
  'تلفاز',
  'تلفزيون',
  'تلفزة',
];

const POWER_KEYWORDS = [
  'battery',
  'batterie',
  'batri',
  'bateri',
  'portable',
  'portatif',
  'rechargeable',
  'rechargable',
  'recharge',
  'power station',
  'powerstation',
  'station energie',
  'station d energie',
  "station d'energie",
  'station electrique',
  'powerbank',
  'power bank',
  'inverter',
  'onduleur',
  'convertisseur',
  'محطة طاقة',
  'محطة الطاقة',
  'محول',
  'عاكس',
  'انفرتر',
  'انفيرتر',
  'بطارية',
  'باطري',
  'باتري',
];

export function isBatteryTvIntent(text = '') {
  if (!text) return false;
  const normalized = normalizeText(text);
  const hasTv = containsAnyKeyword(normalized, TV_KEYWORDS);
  if (!hasTv) return false;
  return containsAnyKeyword(normalized, POWER_KEYWORDS);
}

export function powerIntentReply(lang = 'dz') {
  if (lang === 'ar') {
    return 'التلفاز بالبطارية نادر. نقدر نقترح: 1) تلفاز عادي مع محطة طاقة/انفرتر، 2) تلفاز محمول قابل للشحن (إذا متوفر). شحال القياس والميزانية';
  }
  if (lang === 'fr') {
    return "Les TV à batterie sont rares. Options : 1) TV classique + station d'énergie/onduleur, 2) TV portable rechargeable (si dispo). Quelle taille et quel budget";
  }
  if (lang === 'en') {
    return 'Battery/portable TVs are rare. Options: 1) regular TV + power station/inverter, 2) portable rechargeable TV (if available). What size and budget';
  }
  return 'Telfaz b lbatri/portable rah qlil. Options: 1) TV 3adi + power station/inverter, 2) TV portable rechargeable (ila kayn). Ch7al size (pouce) w budget';
}
