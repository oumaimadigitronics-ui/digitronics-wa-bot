/**
 * Shared category keywords used across the codebase
 * These are used for category detection in various contexts
 */

export const TV_KEYWORDS = [
  'tv',
  'tele',
  'télé',
  'television',
  'télévision',
  'talfaza',
  'televiseur',
  'تلفاز',
  'تلفزة',
  'تلفزيون',
  'شاشة',
];

export const FRIDGE_KEYWORDS = [
  'frigo',
  'fridge',
  'réfrigérateur',
  'refrigerateur',
  'réfrigérateurs',
  'refrigerateurs',
  'ثلاجة',
  'ثلاجات',
];

export const WASHING_MACHINE_KEYWORDS = [
  'machine a laver',
  'machine à laver',
  'lave-linge',
  'lave linge',
  'washing machine',
  'washing',
  'غسالة',
  'غسالات',
];

export const AC_KEYWORDS = [
  'climatiseur',
  'clim',
  'climatisation',
  'air conditioner',
  'air condition',
  'ac',
  'مكيف',
  'مكيفات',
];

export const OTHER_CATEGORY_KEYWORDS = [
  ...FRIDGE_KEYWORDS,
  ...WASHING_MACHINE_KEYWORDS,
  ...AC_KEYWORDS,
  'chauffe-eau',
  'chauffe eau',
  'boiler',
  'water heater',
  'سخان',
];
