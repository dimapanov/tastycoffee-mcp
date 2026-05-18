#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  listCategories,
  listProducts,
  searchProducts,
  getProduct,
} from "./catalog.js";
import {
  fetchCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} from "./cart.js";
import {
  startPhoneLogin,
  checkPhoneStatus,
  resendPhoneCode,
  completePhoneLogin,
  logout,
  whoami,
  listOrders,
  getOrderInvoice,
} from "./auth.js";
import { analyzeHistory } from "./analytics.js";
import {
  checkoutStatus,
  listPvzPoints,
  getDeliveryOptions,
  getPaymentMethods,
  searchAddress,
  getCityByFias,
  setCheckoutForm,
  getCheckoutForm,
  clearCheckoutForm,
  applyCoupon,
  applyVoucher,
  placeOrder,
} from "./checkout.js";

const tools: {
  name: string;
  description: string;
  inputSchema: any;
  zod: z.ZodTypeAny;
  handler: (args: any) => Promise<any>;
}[] = [
  // ============= Catalog =============
  {
    name: "list_categories",
    description: "Список верхнеуровневых категорий магазина tastycoffee",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await listCategories(),
  },
  {
    name: "list_products",
    description:
      "Список товаров с пагинацией, фильтрами и сортировкой. Можно указать category (coffee/tea/...) ИЛИ type (popular/new/weekly/kits). Поддержка: all_pages для получения всего каталога, used_for для фильтра по назначению (например 'фильтр' или 'эспрессо'), sort по rating/reviews/price/per_kg. Каждый товар содержит prices_by_weight с ценой за кг с учётом скидок.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "coffee|tea|accessories|chocolate|giftbox",
        },
        type: {
          type: "string",
          enum: ["popular", "new", "weekly", "kits"],
        },
        used_for: {
          type: "string",
          description: "Фильтр по полю used_for (например 'фильтр' или 'эспрессо')",
        },
        all_pages: {
          type: "boolean",
          description: "Получить все страницы каталога (124 кофе вместо 12)",
        },
        page: { type: "number" },
        per_page: { type: "number", default: 50 },
        sort: {
          type: "string",
          enum: ["rating", "reviews", "price_asc", "price_desc", "per_kg_asc", "per_kg_desc"],
        },
        include_archive: { type: "boolean", default: false },
        limit: { type: "number" },
      },
    },
    zod: z
      .object({
        category: z.string().optional(),
        type: z.enum(["popular", "new", "weekly", "kits"]).optional(),
        used_for: z.string().optional(),
        all_pages: z.boolean().optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().max(100).optional(),
        sort: z
          .enum(["rating", "reviews", "price_asc", "price_desc", "per_kg_asc", "per_kg_desc"])
          .optional(),
        include_archive: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
      })
      .strict(),
    handler: async (a) => await listProducts(a),
  },
  {
    name: "search_products",
    description:
      "Поиск по каталогу tastycoffee. Возвращает товары совпадающие с запросом.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 20 },
      },
      required: ["query"],
    },
    zod: z
      .object({
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict(),
    handler: async (a) => await searchProducts(a.query, a.limit),
  },
  {
    name: "get_product",
    description:
      "Детали товара по slug (например '/coffee/black-candy') или URL. Возвращает варианты помола (grind) и объёма (weight) с их option_value_id.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
    zod: z.object({ slug: z.string().min(2) }).strict(),
    handler: async (a) => await getProduct(a.slug),
  },

  // ============= Cart =============
  {
    name: "view_cart",
    description:
      "Текущая корзина с пересчитанными ценами через серверный API. Корзина хранится локально и пересчитывается на сервере.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await fetchCart(),
  },
  {
    name: "add_to_cart",
    description:
      "Добавить товар в корзину. Указывайте product (slug/URL) и опционально grind+weight (можно по названию или option_value_id). По умолчанию выбираются первые варианты.",
    inputSchema: {
      type: "object",
      properties: {
        product: { type: "string", description: "slug или URL товара" },
        grind: {
          type: "string",
          description: 'Помол: например "в зёрнах" или option_value_id (число)',
        },
        weight: {
          type: "string",
          description: 'Объём: например "250 г", "1000 г" или option_value_id',
        },
        quantity: { type: "number", default: 1 },
        options: {
          type: "array",
          items: { type: "number" },
          description: "Прямой массив option_value_id (заменяет grind/weight)",
        },
      },
      required: ["product"],
    },
    zod: z
      .object({
        product: z.string().min(2),
        grind: z.union([z.string(), z.number()]).optional(),
        weight: z.union([z.string(), z.number()]).optional(),
        quantity: z.number().int().positive().optional(),
        options: z.array(z.number()).optional(),
        for_gift: z.union([z.string(), z.number()]).nullable().optional(),
      })
      .strict(),
    handler: async (a) =>
      await addToCart({
        ...a,
        grind: a.grind !== undefined ? String(a.grind) : undefined,
        weight: a.weight !== undefined ? String(a.weight) : undefined,
      }),
  },
  {
    name: "update_cart_item",
    description: "Изменить количество позиции по index (с 0) или product_id.",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number" },
        product_id: { type: "number" },
        quantity: { type: "number" },
      },
      required: ["quantity"],
    },
    zod: z
      .object({
        index: z.number().int().nonnegative().optional(),
        product_id: z.number().int().positive().optional(),
        quantity: z.number().int().nonnegative(),
      })
      .strict(),
    handler: async (a) => await updateCartItem(a),
  },
  {
    name: "remove_from_cart",
    description: "Удалить позицию из корзины (по index или product_id).",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number" },
        product_id: { type: "number" },
      },
    },
    zod: z
      .object({
        index: z.number().int().nonnegative().optional(),
        product_id: z.number().int().positive().optional(),
      })
      .strict(),
    handler: async (a) => await removeFromCart(a),
  },
  {
    name: "clear_cart",
    description: "Полностью очистить корзину.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await clearCart(),
  },

  // ============= Auth =============
  {
    name: "start_phone_login",
    description:
      "Шаг 1 авторизации: запросить код по номеру телефона. Код отправляется в Telegram-бот (или резервный канал).",
    inputSchema: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
    zod: z.object({ phone: z.string().min(10) }).strict(),
    handler: async (a) => await startPhoneLogin(a.phone),
  },
  {
    name: "check_phone_login_status",
    description: "Проверить статус доставки кода (pending/delivered/seen).",
    inputSchema: {
      type: "object",
      properties: { code_id: { type: "number" } },
    },
    zod: z.object({ code_id: z.number().int().positive().optional() }).strict(),
    handler: async (a) => await checkPhoneStatus(a.code_id),
  },
  {
    name: "resend_phone_code",
    description: "Запросить повторную отправку кода.",
    inputSchema: {
      type: "object",
      properties: { code_id: { type: "number" } },
    },
    zod: z.object({ code_id: z.number().int().positive().optional() }).strict(),
    handler: async (a) => await resendPhoneCode(a.code_id),
  },
  {
    name: "complete_phone_login",
    description:
      "Шаг 2: подтвердить код. Сохраняет JWT-токен в ~/.tastycoffee-mcp/token.json.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        code_id: { type: "number" },
      },
      required: ["code"],
    },
    zod: z
      .object({
        code: z.union([z.string(), z.number()]).transform((v) => String(v)),
        code_id: z.number().int().positive().optional(),
      })
      .strict(),
    handler: async (a) => await completePhoneLogin(a.code, a.code_id),
  },
  {
    name: "whoami",
    description: "Информация о текущем авторизованном пользователе.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await whoami(),
  },
  {
    name: "logout",
    description: "Удалить сохранённый JWT-токен.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await logout(),
  },

  // ============= Orders =============
  {
    name: "list_orders",
    description: "История заказов авторизованного пользователя.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
        page: { type: "number", default: 1 },
        current: { type: "boolean", description: "Только активные" },
      },
    },
    zod: z
      .object({
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        current: z.boolean().optional(),
      })
      .strict(),
    handler: async (a) => await listOrders(a),
  },
  {
    name: "analyze_history",
    description:
      "Аналитика по истории заказов: сколько кг кофе в месяц, темп заказов, любимые сорта, распределение по размеру пачек, рекомендация по подписке. Требует авторизации.",
    inputSchema: {
      type: "object",
      properties: {
        window_days: {
          type: "number",
          description: "Окно для рекомендации (по умолчанию 90 дней)",
        },
      },
    },
    zod: z
      .object({ window_days: z.number().int().positive().max(3650).optional() })
      .strict(),
    handler: async (a) => await analyzeHistory(a),
  },
  {
    name: "get_order",
    description: "Детали конкретного заказа по id.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "number" } },
      required: ["order_id"],
    },
    zod: z.object({ order_id: z.number().int().positive() }).strict(),
    handler: async (a) => await getOrderInvoice(a.order_id),
  },

  // ============= Checkout =============
  {
    name: "search_address",
    description:
      "Поиск адреса/города через Dadata (используется бэкендом tastycoffee).",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    zod: z.object({ query: z.string().min(2) }).strict(),
    handler: async (a) => await searchAddress(a.query),
  },
  {
    name: "list_pvz_points",
    description:
      "Список пунктов выдачи для выбранного тарифа (shipping_code: 'dpd.2', 'cdek.2', 'pochta.1' и др.). Опциональный query фильтрует по адресу. Возвращает id, который нужен для set_checkout_form pvz_id.",
    inputSchema: {
      type: "object",
      properties: {
        shipping_code: { type: "string" },
        query: { type: "string", description: "фильтр по адресу, например 'Линейная'" },
      },
      required: ["shipping_code"],
    },
    zod: z
      .object({
        shipping_code: z.string().min(1),
        query: z.string().optional(),
      })
      .strict(),
    handler: async (a) => await listPvzPoints(a),
  },
  {
    name: "checkout_status",
    description:
      "Проверить статус отправленного checkout-запроса. Нужен только если place_order вернул checkout_status='pending'.",
    inputSchema: {
      type: "object",
      properties: {
        checkout_request_id: { type: "string" },
        checkout_request_token: { type: "string" },
      },
      required: ["checkout_request_id"],
    },
    zod: z
      .object({
        checkout_request_id: z.string().min(1),
        checkout_request_token: z.string().optional(),
      })
      .strict(),
    handler: async (a) => await checkoutStatus(a),
  },
  {
    name: "get_delivery_options",
    description:
      "Доступные тарифы доставки для текущей корзины и адреса. Сначала установите address/dadata_address через set_checkout_form.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await getDeliveryOptions(),
  },
  {
    name: "get_payment_methods",
    description: "Доступные способы оплаты для текущей корзины.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await getPaymentMethods(),
  },
  {
    name: "set_checkout_form",
    description:
      "Заполнить форму оформления заказа. Контакты можно передавать или вложенным объектом user, или плоскими полями full_name/name/phone/email (будут перенесены в cart.user при отправке; телефон нормализуется до 11 цифр без '+'). Для ПВЗ: delivery_type='pvz', shipping_code='dpd.2'/'cdek.2'/..., pvz_id (из list_pvz_points).",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: ["string", "null"] },
        address_id: { type: ["number", "null"] },
        dadata_address: {},
        delivery_type: { type: ["string", "null"] },
        payment_code: { type: ["string", "null"] },
        postcode: { type: ["string", "null"] },
        shipping_code: { type: ["string", "null"] },
        shipping_flat: { type: ["string", "null"] },
        pvz_id: { type: ["string", "null"] },
        coupon_code: { type: "string" },
        voucher_code: { type: "string" },
        user: {
          type: "object",
          properties: {
            full_name: { type: "string" },
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
          },
        },
        full_name: { type: "string" },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        user_date_interval: {},
        user_time_interval: {},
      },
    },
    zod: z.object({}).passthrough(),
    handler: async (a) => await setCheckoutForm(a),
  },
  {
    name: "get_checkout_form",
    description: "Текущее содержимое формы оформления заказа (сохранено локально).",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await getCheckoutForm(),
  },
  {
    name: "clear_checkout_form",
    description: "Сбросить локальную форму оформления заказа.",
    inputSchema: { type: "object", properties: {} },
    zod: z.object({}).strict(),
    handler: async () => await clearCheckoutForm(),
  },
  {
    name: "apply_coupon",
    description: "Применить промокод к корзине.",
    inputSchema: {
      type: "object",
      properties: { coupon_code: { type: "string" } },
      required: ["coupon_code"],
    },
    zod: z.object({ coupon_code: z.string().min(1) }).strict(),
    handler: async (a) => await applyCoupon(a.coupon_code),
  },
  {
    name: "apply_voucher",
    description: "Применить ваучер/сертификат к корзине.",
    inputSchema: {
      type: "object",
      properties: { voucher_code: { type: "string" } },
      required: ["voucher_code"],
    },
    zod: z.object({ voucher_code: z.string().min(1) }).strict(),
    handler: async (a) => await applyVoucher(a.voucher_code),
  },
  {
    name: "place_order",
    description:
      "Оформить заказ. Без confirm=true — dry-run с превью и проверкой полей. С confirm=true — отправка через POST /api/v2/checkout. Требуется авторизация и заполненная форма (delivery_type, payment_code, адрес).",
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          default: false,
          description: "true для фактической отправки",
        },
      },
    },
    zod: z.object({ confirm: z.boolean().optional() }).strict(),
    handler: async (a) => await placeOrder({ confirm: !!a.confirm }),
  },
];

const server = new Server(
  { name: "tastycoffee-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Неизвестный инструмент: ${req.params.name}` }],
      isError: true,
    };
  }
  try {
    const args = tool.zod.parse(req.params.arguments ?? {});
    const result = await tool.handler(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Ошибка ${tool.name}: ${e.message}${
            e.data ? "\n" + JSON.stringify(e.data, null, 2) : ""
          }`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("tastycoffee-mcp running on stdio");
});
