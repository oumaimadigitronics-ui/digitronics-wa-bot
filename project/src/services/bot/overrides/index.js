import { cityDeliveryReply, isCityDeliveryIntent } from '../../lang/cityDelivery.js';
import { isGreeting, isMenuHelpIntent } from '../../lang/greeting.js';
import { extractMoroccoPhone, phoneConfirmReply } from '../../lang/phoneMA.js';
import { isBatteryTvIntent, powerIntentReply } from '../../lang/powerIntent.js';
import { hasBye, hasQuestionOrProductIntent, isThanks, thanksReply } from '../../lang/thanks.js';
import { buildMainMenu } from '../../menu/menuBuilder.js';

function phoneOverride(ctx) {
  if (!ctx?.userText) return null;
  const phone = extractMoroccoPhone(ctx.userText);
  if (!phone) return null;
  return { reply: phoneConfirmReply(ctx.preferredLang, phone), reason: 'phone' };
}

function thanksOverride(ctx) {
  if (!ctx?.userText) return null;
  if (hasQuestionOrProductIntent(ctx.userText)) return null;
  if (!isThanks(ctx.userText)) return null;
  return { reply: thanksReply(ctx.preferredLang, { isBye: hasBye(ctx.userText) }), reason: 'thanks' };
}

function batteryOverride(ctx) {
  if (!ctx?.userText) return null;
  if (!isBatteryTvIntent(ctx.userText)) return null;
  return { reply: powerIntentReply(ctx.preferredLang), reason: 'battery-tv' };
}

function cityOverride(ctx) {
  if (!ctx?.userText) return null;
  if (!isCityDeliveryIntent(ctx.userText)) return null;
  return { reply: cityDeliveryReply(ctx.preferredLang), reason: 'city-delivery' };
}

function greetingMenuOverride(ctx) {
  if (!ctx?.userText) return null;
  if (!isGreeting(ctx.userText) && !isMenuHelpIntent(ctx.userText)) return null;
  return { reply: buildMainMenu({ preferredLang: ctx.preferredLang }), reason: 'menu' };
}

export const OVERRIDES = [
  phoneOverride,
  thanksOverride,
  batteryOverride,
  cityOverride,
  greetingMenuOverride,
];

export function pickOverride(ctx) {
  for (const rule of OVERRIDES) {
    const match = rule?.(ctx);
    if (match?.reply) {
      return match;
    }
  }
  return null;
}
