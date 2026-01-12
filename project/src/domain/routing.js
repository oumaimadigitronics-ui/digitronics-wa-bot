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
  isWarrantyIntent
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

// Note: isProductAdviceIntent and resolveAdvice still come from server.js
// These will be handled in a future phase when server.js is fully modularized
// For now, routing.js is used by server.js, so these references work via closure

/**
 * Routes a user message to the appropriate response template(s)
 * 
 * Priority order:
 * 1. Angry customers → ESCALATION_TEMPLATE (highest priority)
 * 2. Confused customers → CLARITY_TEMPLATE
 * 3. Support issues → SUPPORT_TEMPLATE
 * 4. Product advice → resolveAdvice()
 * 5. Multiple intents → Combined templates (buy, contact, delivery, payment, warranty)
 * 
 * @param {string} text - The user's message text
 * @returns {string|null} The appropriate template(s) or null if no match
 */
export function routeTemplate(text) {
  if (isAngryIntent(text)) return ESCALATION_TEMPLATE;
  if (isConfusedIntent(text)) return CLARITY_TEMPLATE;
  if (isSupportIntent(text)) return SUPPORT_TEMPLATE;
  if (isProductAdviceIntent(text)) return resolveAdvice(text, {});

  const templates = [];
  if (isBuyIntent(text) || hasQuantitySignal(text)) templates.push(BUY_INTENT_TEMPLATE);
  if (isContactIntent(text)) templates.push(CONTACT_TEMPLATE);
  if (isDeliveryIntent(text)) templates.push(DELIVERY_TEMPLATE);
  if (isPaymentIntent(text)) templates.push(PAYMENT_TEMPLATE);
  if (isWarrantyIntent(text)) templates.push(WARRANTY_TEMPLATE);
  if (!templates.length) return null;
  return templates.join("\n\n");
}
