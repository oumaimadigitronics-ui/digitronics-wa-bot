// Brand-related constants and priority lists

// RULE #1 no questions
export const BRAND_PRIORITY = [
  "TCL",
  "Daiko",
  "Haier",
  "Samsung",
  "LG",
  "Elexia",
  "Revolution",
  "Visio",
  "Echolink",
  "Hisense",
  "Tivoli",
];

// TV-specific brand priority (uppercase version)
export const TV_BRAND_PRIORITY = BRAND_PRIORITY.map((b) => String(b || "").toUpperCase());
