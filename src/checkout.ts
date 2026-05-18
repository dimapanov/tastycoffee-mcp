import {
  api,
  buildCartPayload,
  loadCart,
  loadCheckout,
  saveCheckout,
  CheckoutForm,
} from "./api.js";

export async function getDeliveryOptions() {
  const items = loadCart();
  if (items.length === 0) throw new Error("Корзина пуста");
  const form = loadCheckout();
  const payload = buildCartPayload(form, items);
  return await api("cart/deliveries", { method: "POST", body: payload });
}

/**
 * Get the list of pickup-point locations for a specific shipping_code (e.g. "dpd.2").
 * Returns the full `pvz_items` array with id/address/etc. that can be passed to
 * set_checkout_form as pvz_id.
 */
export async function listPvzPoints(opts: { shipping_code: string; query?: string }) {
  const items = loadCart();
  if (items.length === 0) throw new Error("Корзина пуста");
  const form = loadCheckout();
  // The server expects the form to indicate a PVZ delivery so it returns points.
  const payload = buildCartPayload(
    { ...form, delivery_type: "pvz", shipping_code: opts.shipping_code, pvz_id: null },
    items
  );
  const resp: any = await api(`cart/deliveries/${opts.shipping_code}`, {
    method: "POST",
    body: payload,
  });
  let points: any[] = resp?.data?.pvz_items || [];
  if (opts.query) {
    const q = opts.query.toLowerCase();
    points = points.filter((p) =>
      [p.address, p.full_address, p.name]
        .filter(Boolean)
        .some((s: string) => s.toLowerCase().includes(q))
    );
  }
  return {
    shipping_code: opts.shipping_code,
    price: resp?.data?.price,
    payment_on_delivery: resp?.data?.payment_on_delivery,
    limits_text: resp?.data?.limits_text,
    count: points.length,
    points,
  };
}

export async function getPaymentMethods() {
  const items = loadCart();
  if (items.length === 0) throw new Error("Корзина пуста");
  const form = loadCheckout();
  const payload = buildCartPayload(form, items);
  return await api("cart/payment-methods", { method: "POST", body: payload });
}

export async function searchAddress(query: string) {
  // The site uses dadata via /search endpoint
  return await api("search", { method: "POST", body: { query } });
}

export async function getCityByFias(city_fias: string) {
  return await api("settlement/dadata", { query: { city_fias } });
}

export async function setCheckoutForm(patch: Partial<CheckoutForm>) {
  const cur = loadCheckout();
  const next = { ...cur, ...patch };
  saveCheckout(next);
  return next;
}

export async function getCheckoutForm() {
  return loadCheckout();
}

export async function clearCheckoutForm() {
  saveCheckout({});
  return {};
}

export async function applyCoupon(coupon_code: string) {
  await setCheckoutForm({ coupon_code });
  const items = loadCart();
  const form = loadCheckout();
  const payload = buildCartPayload(form, items);
  return await api("cart/coupon", { method: "POST", body: payload });
}

export async function applyVoucher(voucher_code: string) {
  await setCheckoutForm({ voucher_code });
  const items = loadCart();
  const form = loadCheckout();
  const payload = buildCartPayload(form, items);
  return await api("cart/voucher", { method: "POST", body: payload });
}

/**
 * Two-phase order placement. confirm=false returns a dry-run preview.
 * confirm=true actually submits via /api/v2/checkout.
 */
export async function placeOrder(opts: { confirm?: boolean } = {}) {
  const items = loadCart();
  if (items.length === 0) throw new Error("Корзина пуста — нечего оформлять");
  const form = loadCheckout();

  // Validate required fields
  const missing: string[] = [];
  if (!form.delivery_type) missing.push("delivery_type");
  if (!form.payment_code) missing.push("payment_code");
  if (
    !form.address &&
    !form.dadata_address &&
    !form.address_id &&
    form.delivery_type !== "pvz"
  )
    missing.push("address|dadata_address|address_id");
  if (form.delivery_type === "pvz" && !form.pvz_id) missing.push("pvz_id");

  const payload = buildCartPayload(form, items);
  // Cart preview always
  const preview: any = await api("cart", { method: "POST", body: payload });

  if (!opts.confirm) {
    return {
      submitted: false,
      dry_run: true,
      message:
        missing.length > 0
          ? `⚠️ Не заполнены поля: ${missing.join(", ")}. Используйте set_checkout_form. Повторите с confirm=true для оформления.`
          : "Готово к отправке. Вызовите place_order с confirm=true для подтверждения.",
      missing_fields: missing,
      preview: preview?.data ?? preview,
      payload_will_be_sent: payload,
    };
  }

  if (missing.length > 0) {
    throw new Error(
      "Невозможно оформить: не заполнены поля " + missing.join(", ")
    );
  }

  const submit: any = await api("checkout", { method: "POST", body: payload });
  const requestId =
    submit?.data?.checkout_request_id || submit?.checkout_request_id || null;
  const requestToken =
    submit?.data?.checkout_request_token || submit?.checkout_request_token || null;

  // Poll checkout status until pending=false (or timeout).
  let status: any = submit?.data;
  if (requestId && status?.pending) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const resp: any = await api(`checkout/${requestId}/status`, {
          method: "GET",
          headers: requestToken
            ? { "X-Checkout-Request-Token": requestToken }
            : undefined,
        });
        status = resp?.data || resp;
        if (!status?.pending) break;
      } catch (err: any) {
        status = { error: err?.message || String(err) };
        break;
      }
    }
  }

  // On success the cart should be cleared locally.
  if (status?.checkout_status === "succeeded") {
    try {
      const { saveCart } = await import("./api.js");
      saveCart([]);
    } catch {}
  }

  return {
    submitted: true,
    dry_run: false,
    order_id: status?.order_id || null,
    price: status?.price || null,
    checkout_status: status?.checkout_status || null,
    success_url: status?.url || null,
    raw: status,
  };
}

export async function checkoutStatus(opts: {
  checkout_request_id: string;
  checkout_request_token?: string;
}) {
  return await api(`checkout/${opts.checkout_request_id}/status`, {
    method: "GET",
    headers: opts.checkout_request_token
      ? { "X-Checkout-Request-Token": opts.checkout_request_token }
      : undefined,
  });
}

export async function getOrderSuccess(query: Record<string, string | number> = {}) {
  return await api("order/success", { query });
}
