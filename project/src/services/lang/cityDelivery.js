const CITY_MARRAKECH_REGEX = /\b(marrake?ch|marrakech|marrakesh|kech)\b/i;
const CITY_AR_MARRAKECH_REGEX = /مراكش/;
const DELIVERY_AVAIL_REGEX =
  /\b(livraison|delivery|deliver|dispo|disponible|availability|available)\b/i;
const DELIVERY_AVAIL_AR_REGEX = /(موجود|كاين|عندكم|التوصيل|توصيل)/;

export function isCityDeliveryIntent(text = '') {
  if (!text) return false;
  const hasCity = CITY_MARRAKECH_REGEX.test(text) || CITY_AR_MARRAKECH_REGEX.test(text);
  if (!hasCity) return false;
  return (
    DELIVERY_AVAIL_REGEX.test(text) ||
    DELIVERY_AVAIL_AR_REGEX.test(text) ||
    /[?؟]/.test(text)
  );
}

export function cityDeliveryReply(preferredLang = 'dz') {
  if (preferredLang === 'ar') {
    return 'نعم، التوفر والتوصيل كاين لمراكش. شنو هو الحي اللي كاين فيه؟ وشنو المنتج والميزانية؟';
  }
  if (preferredLang === 'fr') {
    return 'Oui, disponibilité/livraison sur Marrakech. C’est quel quartier ? Et quel produit + budget ?';
  }
  if (preferredLang === 'en') {
    return 'Yes, we can deliver to Marrakech. Which neighborhood, and what product + budget?';
  }
  return 'Kayn dispo/livraison l-Marrakech. Chno howa l7ay? W achno l-produit w budget?';
}
