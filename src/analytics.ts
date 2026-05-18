import { api } from "./api.js";

type Order = {
  id: number;
  created_at: string;
  is_has_coffee_product?: boolean;
  total_price?: number;
  products?: any[];
  delivery?: any;
};

function parseGrams(s: string): number {
  const m = String(s).match(/(\d+(?:[.,]\d+)?)\s*(г|гр|кг|g|kg)/i);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(",", "."));
  return /к/i.test(m[2]) || /^kg/i.test(m[2]) ? v * 1000 : v;
}

async function fetchAllOrders(maxPages = 20, perPage = 50): Promise<Order[]> {
  const all: Order[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data: any = await api("account/orders", {
      query: { page, limit: perPage },
    });
    const items: Order[] = data?.data || [];
    all.push(...items);
    if (items.length < perPage) break;
  }
  return all;
}

export async function analyzeHistory(opts: { window_days?: number } = {}) {
  const orders = await fetchAllOrders();
  const now = new Date();

  // Coffee orders only
  const coffee = orders.filter((o) => o.is_has_coffee_product);
  const dates = coffee.map((o) => new Date(o.created_at)).sort((a, b) => +a - +b);

  // Pack stats
  type Item = { date: Date; name: string; grams: number; count: number; order_id: number };
  const items: Item[] = [];
  for (const o of coffee) {
    const d = new Date(o.created_at);
    for (const p of o.products || []) {
      if (p.is_gift) continue;
      let g = 0;
      for (const po of p.product_options || []) {
        const v = po.value || po.option_value || "";
        const w = parseGrams(v);
        if (w > g) g = w;
      }
      const cnt = p.count || 1;
      const name = (p.name || p.product_name || "").trim();
      // Heuristic: include if grams detected (250/500/1000) — that filters out accessories
      if (g === 0) continue;
      items.push({ date: d, name, grams: g, count: cnt, order_id: o.id });
    }
  }

  function windowStats(days?: number) {
    const subset = days
      ? items.filter((i) => (+now - +i.date) / 86400000 <= days)
      : items;
    const totalGrams = subset.reduce((s, i) => s + i.grams * i.count, 0);
    const totalPacks = subset.reduce((s, i) => s + i.count, 0);
    if (subset.length === 0)
      return { packs: 0, kg: 0, kg_per_month: 0, packs_per_month: 0 };
    const months = days ? days / 30.44 : windowSpanMonths(subset);
    return {
      packs: totalPacks,
      kg: +(totalGrams / 1000).toFixed(2),
      kg_per_month: +((totalGrams / 1000) / months).toFixed(2),
      packs_per_month: +(totalPacks / months).toFixed(2),
    };
  }

  function windowSpanMonths(subset: Item[]) {
    if (subset.length < 2) return 1;
    const ds = subset.map((i) => +i.date).sort();
    const days = (ds[ds.length - 1] - ds[0]) / 86400000;
    return Math.max(1, days / 30.44);
  }

  // Intervals between consecutive coffee orders
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push((+dates[i] - +dates[i - 1]) / 86400000);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const median = sortedGaps.length
    ? sortedGaps[Math.floor(sortedGaps.length / 2)]
    : 0;

  // Top coffees
  const byName = new Map<string, { packs: number; grams: number }>();
  for (const it of items) {
    const cur = byName.get(it.name) || { packs: 0, grams: 0 };
    cur.packs += it.count;
    cur.grams += it.grams * it.count;
    byName.set(it.name, cur);
  }
  const top = [...byName.entries()]
    .map(([name, v]) => ({ name, packs: v.packs, kg: +(v.grams / 1000).toFixed(2) }))
    .sort((a, b) => b.packs - a.packs);

  // Pack size distribution
  const sizeCounts = new Map<number, number>();
  for (const it of items) {
    sizeCounts.set(it.grams, (sizeCounts.get(it.grams) || 0) + it.count);
  }
  const pack_sizes = [...sizeCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([grams, count]) => ({ grams, packs: count }));

  // By year
  const byYear = new Map<number, number>();
  for (const o of coffee) {
    const y = new Date(o.created_at).getFullYear();
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  const orders_by_year = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, orders: count }));

  // Recommendation based on last 3-6 months
  const recent = windowStats(opts.window_days ?? 90);
  const sixMo = windowStats(180);
  const recommendedKgPerMonth = Math.max(recent.kg_per_month, sixMo.kg_per_month);

  return {
    totals: {
      orders_with_coffee: coffee.length,
      first_order: dates[0]?.toISOString().slice(0, 10),
      last_order: dates[dates.length - 1]?.toISOString().slice(0, 10),
      span_days: dates.length
        ? Math.round((+dates[dates.length - 1] - +dates[0]) / 86400000)
        : 0,
    },
    cadence: {
      avg_gap_days: gaps.length
        ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1)
        : 0,
      median_gap_days: Math.round(median),
      min_gap_days: gaps.length ? Math.round(Math.min(...gaps)) : 0,
      max_gap_days: gaps.length ? Math.round(Math.max(...gaps)) : 0,
      days_since_last_order: dates.length
        ? Math.round((+now - +dates[dates.length - 1]) / 86400000)
        : null,
    },
    consumption: {
      all_time: windowStats(),
      last_3_months: windowStats(90),
      last_6_months: windowStats(180),
      last_12_months: windowStats(365),
    },
    recommendation: {
      kg_per_month: +recommendedKgPerMonth.toFixed(2),
      suggestion:
        recommendedKgPerMonth >= 0.9
          ? "Берите 1 кг кофе каждые ~30 дней (примерно ваш текущий темп)."
          : recommendedKgPerMonth >= 0.4
          ? "Берите ~500 г кофе в месяц или 1 кг раз в 2 месяца."
          : "Заказываете эпизодически — берите 250 г по мере необходимости.",
    },
    pack_sizes,
    top_coffees: top.slice(0, 15),
    orders_by_year,
  };
}
