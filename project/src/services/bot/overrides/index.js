function phoneOverride(ctx) {
  return null;
}

function thanksOverride(ctx) {
  return null;
}

function batteryOverride(ctx) {
  return null;
}

function cityOverride(ctx) {
  return null;
}

function greetingMenuOverride(ctx) {
  return null;
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
