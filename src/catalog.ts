import { api } from "./api.js";

export const CATEGORIES = [
  { slug: "coffee", title: "Кофе" },
  { slug: "tea", title: "Чай" },
  { slug: "accessories", title: "Аксессуары и мерч" },
  { slug: "chocolate", title: "Шоколад и сиропы" },
  { slug: "giftbox", title: "Наборы" },
  { slug: "subscription", title: "Подписка на кофе" },
];

export type ProductCard = {
  id: number;
  name: string;
  slug: string;
  url: string;
  category: string;
  used_for?: string;
  price?: number;
  rating?: number;
  reviews_count?: number;
  processing_method?: string;
  mini_description?: string;
  is_archive?: boolean;
  /** Effective per-weight prices: list_price (no discount) and your_price (after auto-discount). */
  prices_by_weight?: {
    title: string;
    grams: number | null;
    list_price: number;
    your_price: number;
    discount_percent: number;
    per_kg_price: number | null;
  }[];
  options?: {
    grind?: { id: number; option_value_id: number; title: string }[];
    weight?: {
      id: number;
      option_value_id: number;
      title: string;
      price: number;
      discount_percent: number;
      price_without_discount?: number;
    }[];
  };
};

function stripHtml(s?: string) {
  if (!s) return s;
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parseGrams(title: string): number | null {
  const m = title.match(/(\d+(?:[.,]\d+)?)\s*(г|гр|кг|g|kg)/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(",", "."));
  return /к/i.test(m[2]) || /^kg/i.test(m[2]) ? v * 1000 : v;
}

function normalizeProduct(p: any): ProductCard {
  const grind = p.selectable_options?.[0]?.values?.map((v: any) => ({
    id: v.id,
    option_value_id: v.option_value_id,
    title: v.title,
  }));
  const weight = p.measurable_option?.values?.map((v: any) => ({
    id: v.id,
    option_value_id: v.option_value_id,
    title: v.title,
    price: v.price,
    discount_percent: v.discount_percent,
    price_without_discount: v.price_without_discount,
  }));

  // Effective prices per weight. The list endpoint sometimes only gives `price` (base) and
  // weight options carry `price_without_discount` and `discount_percent`.
  let prices_by_weight: ProductCard["prices_by_weight"];
  if (Array.isArray(weight) && weight.length > 0) {
    prices_by_weight = weight.map((v: any) => {
      const grams = parseGrams(v.title);
      const list = v.price_without_discount ?? (p.price ?? 0) + (v.price ?? 0);
      const disc = v.discount_percent || 0;
      const your = Math.round(list * (100 - disc) / 100);
      return {
        title: v.title,
        grams,
        list_price: list,
        your_price: your,
        discount_percent: disc,
        per_kg_price: grams ? Math.round((your / grams) * 1000) : null,
      };
    });
  }

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    url: `https://shop.tastycoffee.ru${p.slug}`,
    category: p.main_category,
    used_for: p.used_for,
    price: p.price,
    rating: p.rating,
    reviews_count: p.reviews_count,
    processing_method: p.processing_method,
    mini_description: stripHtml(p.mini_description),
    is_archive: p.is_archive,
    prices_by_weight,
    options: { grind, weight },
  };
}

export async function listCategories() {
  return CATEGORIES.map((c) => ({
    ...c,
    url: `https://shop.tastycoffee.ru/${c.slug}`,
  }));
}

export type ListProductsOpts = {
  category?: string;
  type?: "popular" | "new" | "weekly" | "kits";
  used_for?: string; // e.g. "фильтр" matches "Для фильтра"
  all_pages?: boolean; // fetch all pages
  page?: number;
  per_page?: number;
  limit?: number;
  sort?: "rating" | "reviews" | "price_asc" | "price_desc" | "per_kg_asc" | "per_kg_desc";
  include_archive?: boolean;
};

export async function listProducts(opts: ListProductsOpts = {}) {
  const items: any[] = [];
  let total: number | undefined;
  let lastPage: number | undefined;

  if (opts.type) {
    const endpoint =
      opts.type === "popular"
        ? "products/popular"
        : opts.type === "new"
        ? "products/new"
        : opts.type === "weekly"
        ? "products/weekly-featured"
        : "products/kits";
    const data: any = await api(endpoint);
    items.push(...(data?.data || []));
    total = data?.total;
  } else {
    const cat = opts.category || "coffee";
    const perPage = opts.per_page ?? 50;
    if (opts.all_pages) {
      let page = 1;
      for (;;) {
        const data: any = await api(`catalog/${cat}`, {
          query: { page, per_page: perPage },
        });
        items.push(...(data?.data || []));
        total = data?.total;
        lastPage = data?.meta?.last_page;
        if (!lastPage || page >= lastPage) break;
        page += 1;
      }
    } else {
      const data: any = await api(`catalog/${cat}`, {
        query: { page: opts.page ?? 1, per_page: perPage },
      });
      items.push(...(data?.data || []));
      total = data?.total;
      lastPage = data?.meta?.last_page;
    }
  }

  let products = items.map(normalizeProduct);

  if (!opts.include_archive) products = products.filter((p) => !p.is_archive);

  if (opts.used_for) {
    const q = opts.used_for.toLowerCase();
    products = products.filter((p) => (p.used_for || "").toLowerCase().includes(q));
  }

  if (opts.sort) {
    const cmp: Record<string, (a: ProductCard, b: ProductCard) => number> = {
      rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.reviews_count || 0) - (a.reviews_count || 0),
      reviews: (a, b) => (b.reviews_count || 0) - (a.reviews_count || 0),
      price_asc: (a, b) => (a.price || 0) - (b.price || 0),
      price_desc: (a, b) => (b.price || 0) - (a.price || 0),
      per_kg_asc: (a, b) => bestPerKg(a) - bestPerKg(b),
      per_kg_desc: (a, b) => bestPerKg(b) - bestPerKg(a),
    };
    products.sort(cmp[opts.sort]);
  }

  if (opts.limit) products = products.slice(0, opts.limit);

  return {
    total_available: total,
    returned: products.length,
    last_page: lastPage,
    products,
  };
}

function bestPerKg(p: ProductCard): number {
  const opts = (p.prices_by_weight || []).filter((x) => x.per_kg_price);
  if (!opts.length) return Number.POSITIVE_INFINITY;
  return Math.min(...opts.map((x) => x.per_kg_price as number));
}

export async function searchProducts(query: string, limit = 20) {
  const data = await api("search/catalog", { query: { query } });
  const items: any[] = data?.data || data?.products || [];
  return items.slice(0, limit).map(normalizeProduct);
}

export async function getProduct(slugOrUrl: string) {
  // slug like "/coffee/black-candy" → endpoint catalog/coffee/black-candy
  const slug = slugOrUrl
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/+/, "");
  const data = await api(`catalog/${slug}`);
  // Response may be { data: product } or product directly
  const p = data?.data ?? data;
  if (!p || !p.id) {
    throw new Error(`Продукт не найден: ${slugOrUrl}`);
  }
  return normalizeProduct(p);
}
