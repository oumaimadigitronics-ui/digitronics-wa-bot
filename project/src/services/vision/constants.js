/**
 * Vision Service Constants
 * 
 * Maps vision API category strings to internal class/category values
 */

/**
 * Maps vision-detected product categories to internal classification
 * @type {Object.<string, {cls: string, category: string}>}
 */
export const VISION_CATEGORY_MAP = {
  tv: { cls: "Tv", category: "Tv" },
  refrigerateur: { cls: "Refrigerateur", category: "Refrigerateur" },
  cuisiniere: { cls: "Cuisiniere", category: "Cuisiniere" },
  lave_linge: { cls: "Machine A Laver", category: "Machine A Laver" },
};
