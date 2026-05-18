# tastycoffee-mcp

MCP-сервер для оформления заказов на [shop.tastycoffee.ru](https://shop.tastycoffee.ru/) через прямые вызовы публичного REST API `/api/v2/`.

Стек: TypeScript + `@modelcontextprotocol/sdk` (Node, stdio).

> Неофициальный клиент. Эндпоинты реверс-инжинирены из JS-бандла Nuxt и HAR-сессии браузера. Магазин в любой момент может изменить API.

## Возможности

**Каталог** — `list_categories`, `list_products` (по категории или подборке `popular`/`new`/`weekly`/`kits`; пагинация, `all_pages`, фильтр `used_for`, сортировка по рейтингу/отзывам/цене/цене за кг), `search_products`, `get_product`. Для каждой фасовки возвращается `prices_by_weight` с `your_price`, `discount_percent`, `per_kg_price`.

**Корзина** — `view_cart`, `add_to_cart`, `update_cart_item`, `remove_from_cart`, `clear_cart`. Локальные позиции лежат в файле состояния, серверный пересчёт идёт через `POST /api/v2/cart` каждый раз.

**Авторизация по номеру** (код приходит в Telegram-бот магазина) — `start_phone_login`, `check_phone_login_status`, `resend_phone_code`, `complete_phone_login`, `whoami`, `logout`. JWT сохраняется в файле состояния.

**История заказов и аналитика** — `list_orders`, `get_order`, `analyze_history` (кг/мес по окнам 3/6/12/all, темп заказов, топ-сорта, фасовки, рекомендация по периодичности).

**Оформление заказа**

- `search_address` (dadata), `get_delivery_options`, `get_payment_methods`.
- `list_pvz_points { shipping_code, query }` — список ПВЗ для тарифа (`dpd.2`, `cdek.2`, `pochta.1`…), фильтр по адресу.
- `set_checkout_form` (адрес, доставка, оплата, контакты — можно плоскими `full_name`/`phone`/`email` или объектом `user`; телефон нормализуется к 11 цифрам без `+`).
- `apply_coupon`, `apply_voucher`.
- `place_order` — **двухфазный**: по умолчанию dry-run с превью; реальная отправка по `confirm: true`. После отправки автоматически опрашивает `checkout/{id}/status` до `succeeded`/`failed`.
- `checkout_status` — ручной запрос статуса, если потребуется.

Всего **29 инструментов**.

## Установка

```bash
git clone https://github.com/<you>/tastycoffee-mcp.git
cd tastycoffee-mcp
npm install
npm run build
```

## Подключение к Claude Desktop / Cursor

Добавьте в `claude_desktop_config.json` (или эквивалент для вашего MCP-клиента):

```json
{
  "mcpServers": {
    "tastycoffee": {
      "command": "node",
      "args": ["/абсолютный/путь/до/tastycoffee-mcp/dist/index.js"]
    }
  }
}
```

## Типовой сценарий заказа

1. `start_phone_login { phone: "+7XXXXXXXXXX" }` → код придёт в Telegram-бот tastycoffee.
2. `complete_phone_login { code: "XXXX" }` → JWT сохранён.
3. `search_products { query: "эфиопия" }` или `list_products { type: "popular" }`.
4. `add_to_cart { product: "/coffee/<slug>", weight: "1000 г", grind: "в зёрнах" }`.
5. Для курьерской доставки — `search_address`, затем `set_checkout_form { dadata_address, delivery_type: "courier", ... }`.
   Для ПВЗ — `list_pvz_points { shipping_code: "dpd.2", query: "<улица>" }`, затем `set_checkout_form { delivery_type: "pvz", shipping_code: "dpd.2", pvz_id, ... }`.
6. `set_checkout_form { payment_code: "cod", full_name, phone, email }`.
7. `place_order {}` — dry-run: видно итог, доставку, недостающие поля.
8. `place_order { confirm: true }` — отправка через `POST /api/v2/checkout` + автоматический polling статуса.

## Переменные окружения

- `TASTYCOFFEE_STATE_DIR` — каталог состояния (по умолчанию `~/.tastycoffee-mcp`).

## Файлы состояния

Все хранятся **вне репозитория**, в `~/.tastycoffee-mcp/`:

- `token.json` — JWT-токен. **Хранится в открытом виде. Не коммитьте, не делитесь.**
- `cart.json` — локальные позиции корзины: `[{ product_id, options: [id], quantity, for_gift }]`.
- `checkout.json` — заполненные поля формы checkout (включая адрес, телефон, email).

`.gitignore` исключает эти файлы на случай, если кто-то поменяет `TASTYCOFFEE_STATE_DIR` на каталог внутри репо.

## Безопасность

- `place_order` без `confirm: true` никогда не отправляет заказ — только показывает превью. Это защита от случайных вызовов LLM.
- JWT даёт полный доступ к аккаунту: чтение профиля, истории заказов, оформление новых заказов. Относитесь к `token.json` как к паролю.
- Сервер по умолчанию запускается через stdio локально и не открывает сетевых портов.

## Замечания по API

- Базовый URL: `https://shop.tastycoffee.ru/api/v2`.
- Авторизация: `Authorization: Bearer <jwt>`.
- Формат item в корзине: строка `"product_id::option_ids_csv::quantity::for_gift"` (поле `id` value-объекта, не `option_value_id`).
- Каталог и корзина работают без авторизации (гостевая корзина). Для `checkout`, `list_orders`, `whoami` нужен JWT.
- Для ПВЗ форма имеет `delivery_type: "pvz"` и отдельный `shipping_code` (например, `dpd.2`); список точек — `POST /cart/deliveries/<shipping_code>`.
- Polling статуса заказа: `GET /checkout/<request_id>/status` с заголовком `X-Checkout-Request-Token`.

## Лицензия

MIT — см. [LICENSE](./LICENSE).
