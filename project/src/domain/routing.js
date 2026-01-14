/**
 * Routing Logic
 * 
 * Routes user messages to appropriate response templates based on detected intents.
 * This module provides the central routing function that determines which template(s)
 * to return based on the user's message intent.
 */

import {
  isAngryIntent,
  isConfusedIntent,
  isSupportIntent,
  isBuyIntent,
  hasQuantitySignal,
  isContactIntent,
  isDeliveryIntent,
  isPaymentIntent,
  isWarrantyIntent,
  isProductAdviceIntent,
  isThanksIntent,
  isFarewellIntent,
  isAffirmationIntent,
  isCatalogIntent,
  isReturnIntent,
  isInstallationIntent,
  isSizeGuideIntent,
  isComparisonIntent
} from './intents.js';

import {
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
  BUY_INTENT_TEMPLATE,
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE,
  THANKS_TEMPLATE,
  FAREWELL_TEMPLATE,
  AFFIRMATION_TEMPLATE,
  CATALOG_OVERVIEW_TEMPLATE,
  RETURN_POLICY_TEMPLATE,
  INSTALLATION_TEMPLATE,
  SIZE_GUIDE_TEMPLATE,
  COMPARISON_TEMPLATE
} from '../services/replies/templates.js';

/**
 * Helper function to format template with language selection
 * @param {Object|String} template - Template that may have language variants
 * @param {string} lang - Language code (dzl, fr, ar)
 * @returns {string} Formatted template
 */
function formatTemplate(template, lang) {
  if (typeof template === 'string') return template;
  if (typeof template === 'object' && template !== null) {
    // Return based on language priority: dzl, fr, ar
    return template[lang] || template.dzl || template.fr || template.ar || '';
  }
  return '';
}

/**
 * Routes a user message to the appropriate response template(s)
 * 
 * Priority order:
 * 1. Angry customers → ESCALATION_TEMPLATE (highest priority)
 * 2. Confused customers → CLARITY_TEMPLATE
 * 3. Support issues → SUPPORT_TEMPLATE
 * 4. Thanks → THANKS_TEMPLATE
 * 5. Farewell → FAREWELL_TEMPLATE
 * 6. Affirmation → AFFIRMATION_TEMPLATE
 * 7. Buy intent → BUY_INTENT_TEMPLATE
 * 8. Contact → CONTACT_TEMPLATE
 * 9. Delivery → DELIVERY_TEMPLATE
 * 10. Payment → PAYMENT_TEMPLATE
 * 11. Warranty → WARRANTY_TEMPLATE
 * 12. Installation → INSTALLATION_TEMPLATE
 * 13. Return policy → RETURN_POLICY_TEMPLATE
 * 14. Size guide → SIZE_GUIDE_TEMPLATE
 * 15. Catalog overview → CATALOG_OVERVIEW_TEMPLATE
 * 16. Comparison → COMPARISON_TEMPLATE
 * 17. Product advice → resolveAdviceFn() if provided
 * 
 * @param {string} text - The user's message text
 * @param {Object} options - Optional configuration
 * @param {Function} options.resolveAdviceFn - Optional advice resolver function from server.js
 * @param {string} options.lang - Language code (dzl, fr, ar)
 * @returns {string|null} The appropriate template(s) or null if no match
 */
export function routeTemplate(text, options = {}) {
  const { resolveAdviceFn, lang = 'dzl' } = options;
  
  // Priority 1: Angry customers (highest priority)
  if (isAngryIntent(text)) return ESCALATION_TEMPLATE;
  
  // Priority 2: Confused customers
  if (isConfusedIntent(text)) return CLARITY_TEMPLATE;
  
  // Priority 3: Support/problem
  if (isSupportIntent(text)) return SUPPORT_TEMPLATE;
  
  // Priority 4: Thanks
  if (isThanksIntent(text)) return formatTemplate(THANKS_TEMPLATE, lang);
  
  // Priority 5: Farewell
  if (isFarewellIntent(text)) return formatTemplate(FAREWELL_TEMPLATE, lang);
  
  // Priority 6: Affirmation (ok/oui)
  if (isAffirmationIntent(text)) return formatTemplate(AFFIRMATION_TEMPLATE, lang);
  
  // Priority 7-16: Check for multiple intents and combine templates
  const templates = [];
  
  if (isBuyIntent(text) || hasQuantitySignal(text)) templates.push(BUY_INTENT_TEMPLATE);
  if (isContactIntent(text)) templates.push(CONTACT_TEMPLATE);
  if (isDeliveryIntent(text)) templates.push(DELIVERY_TEMPLATE);
  if (isPaymentIntent(text)) templates.push(PAYMENT_TEMPLATE);
  if (isWarrantyIntent(text)) templates.push(WARRANTY_TEMPLATE);
  if (isInstallationIntent(text)) templates.push(formatTemplate(INSTALLATION_TEMPLATE, lang));
  if (isReturnIntent(text)) templates.push(formatTemplate(RETURN_POLICY_TEMPLATE, lang));
  if (isSizeGuideIntent(text)) templates.push(formatTemplate(SIZE_GUIDE_TEMPLATE, lang));
  if (isCatalogIntent(text)) templates.push(formatTemplate(CATALOG_OVERVIEW_TEMPLATE, lang));
  if (isComparisonIntent(text)) templates.push(formatTemplate(COMPARISON_TEMPLATE, lang));
  
  if (templates.length > 0) return templates.join("\n\n");
  
  // Priority 17: Product advice - If product advice intent detected and resolver provided, use it
  if (isProductAdviceIntent(text) && typeof resolveAdviceFn === 'function') {
    return resolveAdviceFn(text, {});
  }

  // No template matched
  return null;
}
