/**
 * Domain Module Exports
 * 
 * Central export point for domain logic including intent detection and routing.
 * Import from this file to access all domain functionality.
 * 
 * @example
 * import { isContactIntent, routeTemplate } from './domain/index.js';
 */

// Re-export all intent detection functions
export {
  isContactIntent,
  isDeliveryIntent,
  isPaymentIntent,
  isWarrantyIntent,
  isAngryIntent,
  isConfusedIntent,
  isSupportIntent,
  isBuyIntent,
  hasQuantitySignal,
  isOrderStatusIntent,
  isProductAdviceIntent
} from './intents.js';

// Re-export routing function
export { routeTemplate } from './routing.js';
