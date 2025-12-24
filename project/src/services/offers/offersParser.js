const KNOWN_BRANDS = ['Samsung', 'Sony', 'LG'];

export function detectBrand(name = '') {
  const lower = name.toLowerCase();
  const match = KNOWN_BRANDS.find((b) => lower.includes(b.toLowerCase()));
  return match || 'UNKNOWN';
}

export function detectModel(name = '') {
  const match = name.toUpperCase().match(/\b([A-Z0-9]{3,})\b/);
  return match ? match[1] : '';
}

export function detectClass(name = '') {
  const lower = name.toLowerCase();
  if (lower.includes('tv')) return 'TV';
  if (lower.includes('laptop')) return 'Laptop';
  if (lower.includes('phone')) return 'Phone';
  return 'General';
}

export function detectCategory(categories = []) {
  if (Array.isArray(categories) && categories.length > 0) {
    const names = categories.map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
    return names[0];
  }
  return 'General';
}

export function extractTvSize(name = '') {
  const match = name.match(/(\d{2,})\s*(?:"|in|inch)/i);
  return match ? match[1] : null;
}

export function offerFromWooProduct(product = {}) {
  const model = product.sku || detectModel(product.name || '');
  if (!model) return null;
  const brand = detectBrand(product.name || '');
  if (!brand || brand === 'UNKNOWN') return null;
  const priceStr = product.sale_price || product.regular_price || product.price;
  const price = priceStr ? Number(priceStr) : NaN;
  if (!Number.isFinite(price)) return null;
  const category = detectCategory(product.categories || []);
  const cls = detectClass(product.name || category);
  const size = extractTvSize(product.name || '') || null;
  const stock = product.stock_status === 'instock' ? Number(product.stock_quantity ?? 1) : 0;
  const link = product.permalink || '';

  return {
    brand,
    model,
    name: product.name || model,
    category,
    size,
    type: product.type || 'simple',
    price,
    class: cls,
    stock,
    link,
  };
}
