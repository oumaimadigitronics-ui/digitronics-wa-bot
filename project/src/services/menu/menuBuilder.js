import { CATEGORY_LABELS, STRONG_CATEGORY_ORDER } from '../../knowledge/catalog.js';

const MENU_HEADERS = {
  ar: 'مرحبا! هادي الفئات اللي كنوفرو:',
  fr: 'Bonjour ! Voici nos catégories :',
  dz: 'Salam! Hadi l-catégories dyalna:',
};

function resolveLang(preferredLang) {
  if (preferredLang === 'ar' || preferredLang === 'fr' || preferredLang === 'dz') return preferredLang;
  return 'dz';
}

export function buildMainMenu({ preferredLang } = {}) {
  const lang = resolveLang(preferredLang);
  const header = MENU_HEADERS[lang] || MENU_HEADERS.dz;
  const lines = STRONG_CATEGORY_ORDER.map((key) => {
    const label = CATEGORY_LABELS[key]?.[lang] || CATEGORY_LABELS[key]?.dz || key;
    return `- ${label}`;
  });
  return `${header}\n${lines.join('\n')}`;
}
