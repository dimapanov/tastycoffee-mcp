import { api, saveToken, loadToken, clearToken } from "./api.js";

// State for pending phone login
let pending: { code_id: number; phone: string; started_at: number } | null = null;

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10) return "7" + digits;
  return digits;
}

export async function startPhoneLogin(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const data: any = await api("login/phone", {
    method: "POST",
    body: { phone },
    auth: false,
  });
  if (!data?.success) throw new Error("Не удалось запросить код: " + JSON.stringify(data));
  pending = { code_id: data.code_id, phone, started_at: Date.now() };
  return {
    phone,
    code_id: data.code_id,
    sent_at: data.time,
    note:
      "Код отправлен. Канал: Telegram-бот (или резервный). Получите код и вызовите check_phone_login с кодом.",
  };
}

export async function checkPhoneStatus(codeId?: number) {
  const cid = codeId ?? pending?.code_id;
  if (!cid) throw new Error("Нет активного входа. Вызовите start_phone_login.");
  const data: any = await api("login/phone-status", {
    method: "POST",
    body: { code_id: cid },
    auth: false,
  });
  return data;
}

export async function resendPhoneCode(codeId?: number) {
  const cid = codeId ?? pending?.code_id;
  if (!cid) throw new Error("Нет активного входа.");
  return await api("login/phone-resend", {
    method: "POST",
    body: { code_id: cid },
    auth: false,
  });
}

export async function completePhoneLogin(code: string, codeId?: number) {
  const cid = codeId ?? pending?.code_id;
  if (!cid) throw new Error("Нет активного входа.");
  const data: any = await api("login/phone-check", {
    method: "POST",
    body: { code: String(code), code_id: cid },
    auth: false,
  });
  if (!data?.token) {
    throw new Error("Авторизация не удалась: " + JSON.stringify(data));
  }
  saveToken(data.token);
  pending = null;
  // Fetch me to confirm
  const me: any = await api("me");
  return { token_saved: true, user: me };
}

export async function logout() {
  clearToken();
  return { ok: true };
}

export async function whoami() {
  const t = loadToken();
  if (!t) return { authenticated: false };
  try {
    const me: any = await api("me");
    return { authenticated: true, user: me };
  } catch (e: any) {
    return { authenticated: false, error: e.message };
  }
}

export async function listOrders(opts: { limit?: number; page?: number; current?: boolean } = {}) {
  const q: any = { limit: opts.limit ?? 10, page: opts.page ?? 1 };
  if (opts.current) q.current = true;
  const data: any = await api("account/orders", { query: q });
  return data;
}

export async function getOrderInvoice(orderId: number) {
  const data: any = await api(`account/orders/${orderId}`);
  return data;
}
