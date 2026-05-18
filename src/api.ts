import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const BASE = "https://shop.tastycoffee.ru/api/v2";
export const SITE = "https://shop.tastycoffee.ru";

const STATE_DIR =
  process.env.TASTYCOFFEE_STATE_DIR ||
  path.join(os.homedir(), ".tastycoffee-mcp");
fs.mkdirSync(STATE_DIR, { recursive: true });

const TOKEN_FILE = path.join(STATE_DIR, "token.json");
const CART_FILE = path.join(STATE_DIR, "cart.json");
const CHECKOUT_FILE = path.join(STATE_DIR, "checkout.json");

export type CartItem = {
  product_id: number;
  options: number[]; // option_value_id values
  quantity: number;
  for_gift?: number | string | null;
};

export type CheckoutUser = {
  full_name?: string;
  name?: string;
  phone?: string;
  email?: string;
  [k: string]: any;
};

export type CheckoutForm = {
  user?: CheckoutUser | null;
  // Convenience flat aliases — set_checkout_form may receive these directly.
  // They are merged into `user` when building the cart payload.
  full_name?: string;
  name?: string;
  phone?: string;
  email?: string;
  address_id?: number | null;
  address?: string | null;
  dadata_address?: any;
  delivery_type?: string | null; // courier|pvz|post|...
  payment_code?: string | null;
  postcode?: string | null;
  shipping_code?: string | null;
  shipping_flat?: string | null;
  coupon_code?: string;
  voucher_code?: string;
  pvz_id?: string | null;
  user_date_interval?: any;
  user_time_interval?: any;
  is_header_city_russia?: boolean | null;
};

export function loadToken(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    return v.token || null;
  } catch {
    return null;
  }
}
export function saveToken(token: string) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, saved_at: new Date().toISOString() }, null, 2));
}
export function clearToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
}

export function loadCart(): CartItem[] {
  try {
    const v = JSON.parse(fs.readFileSync(CART_FILE, "utf8"));
    return Array.isArray(v.items) ? v.items : [];
  } catch {
    return [];
  }
}
export function saveCart(items: CartItem[]) {
  fs.writeFileSync(CART_FILE, JSON.stringify({ items }, null, 2));
}

export function loadCheckout(): CheckoutForm {
  try {
    return JSON.parse(fs.readFileSync(CHECKOUT_FILE, "utf8"));
  } catch {
    return {};
  }
}
export function saveCheckout(c: CheckoutForm) {
  fs.writeFileSync(CHECKOUT_FILE, JSON.stringify(c, null, 2));
}

export function encodeItems(items: CartItem[]): string[] {
  // Format used by the frontend: "product_id::options_csv::quantity::for_gift"
  return items.map(
    (it) =>
      `${it.product_id}::${(it.options || []).join(",")}::${it.quantity}::${it.for_gift ?? "0"}`
  );
}

function normalizePhone(p?: string | null): string | undefined {
  if (!p) return undefined;
  const digits = String(p).replace(/\D+/g, "");
  // Russian numbers: +7XXXXXXXXXX → 7XXXXXXXXXX (server rejects '+').
  // 8XXXXXXXXXX → 7XXXXXXXXXX.
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  return digits;
}

export function mergeCheckoutUser(form: CheckoutForm): CheckoutUser | null {
  const u = { ...(form.user || {}) } as CheckoutUser;
  // Flat aliases overwrite blanks in user
  if (form.full_name && !u.full_name) u.full_name = form.full_name;
  if (form.name && !u.name) u.name = form.name;
  if (form.phone && !u.phone) u.phone = form.phone;
  if (form.email && !u.email) u.email = form.email;
  // Server requires full_name; mirror from name if missing.
  if (!u.full_name && u.name) u.full_name = u.name;
  if (!u.name && u.full_name) u.name = u.full_name;
  const phone = normalizePhone(u.phone);
  if (phone) u.phone = phone;
  return Object.keys(u).length ? u : null;
}

export function buildCartPayload(
  form: CheckoutForm,
  items: CartItem[],
  isRussiaHeader: boolean | null = null
) {
  return {
    cart: {
      user: mergeCheckoutUser(form),
      items: encodeItems(items),
      address_id: form.address_id ?? null,
      address: form.address ?? null,
      dadata_address: form.dadata_address ?? null,
      delivery_type: form.delivery_type ?? null,
      payment_code: form.payment_code ?? null,
      postcode: form.postcode ?? null,
      shipping_code: form.shipping_code ?? null,
      shipping_flat: form.shipping_flat ?? null,
      coupon_code: form.coupon_code ?? "",
      voucher_code: form.voucher_code ?? "",
      pvz_id: form.delivery_type === "pvz" ? form.pvz_id ?? null : null,
      user_date_interval: form.user_date_interval ?? null,
      user_time_interval: form.user_time_interval ?? null,
      is_header_city_russia: isRussiaHeader,
    },
  };
}

export type ApiOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  query?: Record<string, string | number | undefined>;
  auth?: boolean; // include Authorization header if available
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function api<T = any>(endpoint: string, opts: ApiOpts = {}): Promise<T> {
  const method = opts.method ?? (opts.body ? "POST" : "GET");
  const url = new URL(`${BASE}/${endpoint.replace(/^\//, "")}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: SITE,
    referer: SITE + "/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
  if (opts.auth !== false) {
    const t = loadToken();
    if (t) headers["authorization"] = t.startsWith("Bearer ") ? t : `Bearer ${t}`;
  }
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    const err: any = new Error(`API ${endpoint} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}
