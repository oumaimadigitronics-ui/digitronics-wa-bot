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
  isProductAdviceIntent
} from './intents.js';

import {
  ESCALATION_TEMPLATE,
  CLARITY_TEMPLATE,
  SUPPORT_TEMPLATE,
  BUY_INTENT_TEMPLATE,
  CONTACT_TEMPLATE,
  DELIVERY_TEMPLATE,
  PAYMENT_TEMPLATE,
  WARRANTY_TEMPLATE
} from '../services/replies/templates.js';

/**
 * Routes a user message to the appropriate response template(s)
 * 
 * Priority order:
 * 1. Angry customers → ESCALATION_TEMPLATE (highest priority)
 * 2. Confused customers → CLARITY_TEMPLATE
 * 3. Support issues → SUPPORT_TEMPLATE
 * 4. Product advice → resolveAdviceFn() if provided
 * 5. Multiple intents → Combined templates (buy, contact, delivery, payment, warranty)
 * 
 * @param {string} text - The user's message text
 * @param {Object} options - Optional configuration
 * @param {Function} options.resolveAdviceFn - Optional advice resolver function from server.js
 * @returns {string|null} The appropriate template(s) or null if no match
 */
export function routeTemplate(text, options = {}) {
  const { resolveAdviceFn } = options;
  
  if (isAngryIntent(text)) return ESCALATION_TEMPLATE;
  if (isConfusedIntent(text)) return CLARITY_TEMPLATE;
  if (isSupportIntent(text)) return SUPPORT_TEMPLATE;
  
  // If product advice intent detected and resolver provided, use it
  if (isProductAdviceIntent(text) && typeof resolveAdviceFn === 'function') {
    return resolveAdviceFn(text, {});
  }

  const templates = [];
  if (isBuyIntent(text) || hasQuantitySignal(text)) templates.push(BUY_INTENT_TEMPLATE);
  if (isContactIntent(text)) templates.push(CONTACT_TEMPLATE);
  if (isDeliveryIntent(text)) templates.push(DELIVERY_TEMPLATE);
  if (isPaymentIntent(text)) templates.push(PAYMENT_TEMPLATE);
  if (isWarrantyIntent(text)) templates.push(WARRANTY_TEMPLATE);
  if (!templates.length) return null;
  return templates.join("\n\n");
}
