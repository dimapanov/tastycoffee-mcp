import {
  api,
  buildCartPayload,
  loadCart,
  saveCart,
  loadCheckout,
  CartItem,
} from "./api.js";
import { getProduct } from "./catalog.js";

/** Fetch full cart from the backend with current items + form. */
export async function fetchCart() {
  const items = loadCart();
  const form = loadCheckout();
  const payload = buildCartPayload(form, items);
  const data: any = await api("cart", { method: "POST", body: payload });
  return summarize(data?.data ?? data, items);
}

function summarize(cart: any, localItems: CartItem[]) {
  if (!cart) return { items: [], total: 0, count: 0, localItems };
  const items = (cart.items || []).map((it: any) => ({
    web_id: it.web_id,
    product_id: it.product?.id,
    name: it.product?.name,
    slug: it.product?.slug,
    url: it.product?.slug
      ? `https://shop.tastycoffee.ru${it.product.slug}`
      : undefined,
    used_for: it.product?.used_for,
    quantity: it.quantity,
    options: it.options,
    option_titles: extractOptionTitles(it),
    line_price: it.product?.price,
  }));
  return {
    items,
    total: cart.prices?.total ?? cart.total ?? 0,
    sub_total: cart.prices?.sub_total,
    coupon: cart.prices?.coupon,
    personal_discount: cart.prices?.personal_discount,
    shipping: cart.shipping,
    weight: cart.weight,
    count: cart.count,
    coupon_code: cart.coupon_code,
    voucher_code: cart.voucher_code,
    has_coffee: cart.has_coffee,
    dates: cart.dates,
    localItems,
  };
}

function extractOptionTitles(it: any): string[] {
  const out: string[] = [];
  const p = it.product;
  if (!p || !Array.isArray(it.options)) return out;
  const pool = [
    ...(p.selectable_options?.flatMap((g: any) => g.values || []) || []),
    ...(p.measurable_option?.values || []),
  ];
  for (const oid of it.options) {
    const v = pool.find((x: any) => x.id === oid) ||
      pool.find((x: any) => x.option_value_id === oid);
    if (v) out.push(v.title);
  }
  return out;
}

export async function addToCart(input: {
  product?: string; // slug, URL or product_id
  grind?: string; // option title or option_value_id
  weight?: string; // option title or option_value_id
  quantity?: number;
  options?: number[]; // override
  for_gift?: number | string | null;
}) {
  const qty = Math.max(1, input.quantity || 1);
  let optionValues: number[] = input.options ? [...input.options] : [];
  let productId: number | undefined;

  if (input.product) {
    const product = await getProduct(input.product);
    productId = product.id;

    // The cart API expects product_option_value_id, which is the `id` field on each value entry (not `option_value_id`).
    // Resolve grind
    if (input.grind && !input.options) {
      const grinds = product.options?.grind || [];
      const found = matchOption(grinds, input.grind);
      if (found) optionValues.push(found.id);
      else if (grinds.length > 0) {
        optionValues.push(grinds[0].id);
      }
    }

    // Resolve weight
    if (input.weight && !input.options) {
      const weights = product.options?.weight || [];
      const found = matchOption(weights, input.weight);
      if (found) optionValues.push(found.id);
      else if (weights.length > 0) {
        optionValues.push(weights[0].id);
      }
    }

    // If no grind/weight provided, pick defaults
    if (!input.options && !input.grind && (product.options?.grind?.length || 0) > 0) {
      optionValues.push(product.options!.grind![0].id);
    }
    if (!input.options && !input.weight && (product.options?.weight?.length || 0) > 0) {
      optionValues.push(product.options!.weight![0].id);
    }
  } else if (typeof (input as any).product_id === "number") {
    productId = (input as any).product_id;
  }

  if (!productId) {
    throw new Error("addToCart: укажите product (slug/url) или options + product_id");
  }

  const items = loadCart();
  // Merge by product_id+options
  const optsKey = [...optionValues].sort().join(",");
  const existing = items.find(
    (it) =>
      it.product_id === productId &&
      [...(it.options || [])].sort().join(",") === optsKey
  );
  if (existing) {
    existing.quantity += qty;
  } else {
    items.push({
      product_id: productId,
      options: optionValues,
      quantity: qty,
      for_gift: input.for_gift ?? 0,
    });
  }
  saveCart(items);
  return await fetchCart();
}

function matchOption(
  list: { id: number; option_value_id: number; title: string }[],
  needle: string | number
) {
  if (typeof needle === "number" || /^\d+$/.test(String(needle))) {
    const n = Number(needle);
    return (
      list.find((x) => x.id === n) ||
      list.find((x) => x.option_value_id === n)
    );
  }
  const q = String(needle).toLowerCase().trim();
  return (
    list.find((x) => x.title.toLowerCase() === q) ||
    list.find((x) => x.title.toLowerCase().includes(q))
  );
}

export async function updateCartItem(input: {
  index?: number;
  product_id?: number;
  quantity: number;
}) {
  const items = loadCart();
  let idx: number | undefined;
  if (typeof input.index === "number") idx = input.index;
  else if (input.product_id !== undefined)
    idx = items.findIndex((i) => i.product_id === input.product_id);
  if (idx === undefined || idx < 0 || idx >= items.length) {
    throw new Error("Позиция не найдена в корзине");
  }
  if (input.quantity <= 0) items.splice(idx, 1);
  else items[idx].quantity = input.quantity;
  saveCart(items);
  return await fetchCart();
}

export async function removeFromCart(input: { index?: number; product_id?: number }) {
  return await updateCartItem({ ...input, quantity: 0 });
}

export async function clearCart() {
  saveCart([]);
  return await fetchCart();
}
