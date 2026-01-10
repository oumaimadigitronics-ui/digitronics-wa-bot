const TV_REGEX = /(tv|television|tele|tlfaz|telfaz|telfaza|تلفاز|تلفزيون|تلفزة)/i;
const POWER_REGEX =
  /(battery|batterie|batri|bateri|portable|portatif|rechargeable|recharge|power\s*station|powerstation|station\s*d'?energie|onduleur|inverter|convertisseur|محطة\s*طاقة|محطة\s*الطاقة|محول|عاكس|انفرتر|بطارية|باطري|باتري)/i;

export function isBatteryTvIntent(text = '') {
  if (!text) return false;
  return TV_REGEX.test(text) && POWER_REGEX.test(text);
}

export function powerIntentReply(lang = 'dz') {
  if (lang === 'ar') {
    return 'تلفاز بالبطارية قليل. نقدر نقترح: 1) تلفاز عادي مع محطة طاقة/انفرتر، 2) تلفاز محمول قابل للشحن (إذا متوفر). شحال القياس والميزانية؟';
  }
  if (lang === 'fr') {
    return "Les TV à batterie sont rares. Options : 1) TV classique + station d'énergie/onduleur, 2) TV portable rechargeable (si dispo). Quelle taille et quel budget ?";
  }
  if (lang === 'en') {
    return 'Battery/portable TVs are rare. Options: 1) regular TV + power station/inverter, 2) portable rechargeable TV (if available). What size and budget?';
  }
  return 'Telfaz b lbatri/portable rah qlil. Options: 1) TV 3adi + power station/inverter, 2) TV portable rechargeable (ila kayn). Ch7al size w budget?';
}
