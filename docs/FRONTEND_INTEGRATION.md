# Интеграция frontend с backend Strikers Club

Документ описывает **реализованный HTTP API** и действия интерфейса. За основу
взяты маршруты в `app/api/routes/`, схемы в `app/schemas/chat.py`, модели в
`app/models/` и сервисы сессий/корзины. Настройка backend и внешних интеграций —
в [CHAT_API.md](CHAT_API.md), запуск — в [README](../README.md).

Backend позволяет вести чат, искать товары EKT, получать карточки и аналоги,
распознавать вложения и подтверждать добавление в демонстрационную корзину.
Состояние временное. Пользователю нужно явно показывать, что корзина
демонстрационная: заказ и резерв на ekt.kz не создаются.

## 1. Адрес, авторизация и граница BFF

Локальный адрес FastAPI — `http://localhost:8000`, префикс API — `/api`.
Префикс может меняться через `API_PREFIX`. Swagger доступен на `/docs`,
машиночитаемая схема — на `/openapi.json`; в production оба отключены.

```text
Браузер → BFF / серверный прокси вашего сайта → FastAPI → OpenAI / EKT
                                                ↓
                                          Redis с TTL
```

**BFF в этом репозитории не реализован.** Это серверная часть вашего frontend
приложения или отдельный доверенный прокси. Он хранит `API_KEY` в серверном
окружении и добавляет его при обращении к FastAPI. Не помещайте `API_KEY`,
`OPENAI_API_KEY`, `EKT_API_USER` или `EKT_API_PASSWORD` в браузерный код,
`VITE_*`, `NEXT_PUBLIC_*`, URL или логи браузера.

Два разных уровня доступа:

| Заголовок FastAPI | Откуда берётся | Когда нужен |
|---|---|---|
| `X-API-Key` | Серверный `.env`, значение `API_KEY` | Все chat/cart/products маршруты |
| `X-Session-Token` | Ответ создания сессии | Сообщения, вложения, чтение и подтверждение корзины |
| `X-Request-ID` | Необязательно, генерируется клиентом | Для сопоставления запроса с логами |

`session_id` сам по себе не даёт доступ к сессии. Токен — её секрет. Не отправляйте
его в query string и не используйте в аналитике.

В примере TypeScript ниже выбран простой контракт BFF: браузер хранит
`session_id` и `session_token` только в памяти и передаёт `X-Session-Token` BFF;
BFF пересылает этот заголовок и добавляет свой `X-API-Key`. После перезагрузки
страницы создаётся новая сессия. Для восстановления вкладки BFF может вместо
этого хранить связь сессии временно на сервере и использовать защищённую
HttpOnly-cookie; тогда браузер не получает backend-токен, а пример клиента
нужно адаптировать к контракту BFF. Сам FastAPI cookie-авторизацию не реализует.

BFF должен разрешать только нужные маршруты, проверять доступ пользователя к
сессии, ограничивать частоту запросов и передавать коды ошибок и request ID.
Для cookie-авторизации предусмотрите защиту от CSRF. При загрузке файла прокси
должен сохранять сырое тело и `Content-Type`; не преобразовывать его в JSON
или multipart. Не включайте кэширование этих ответов.

## 2. Список маршрутов

Во всех примерах указан путь **FastAPI**. Префикс BFF выбирает frontend-команда.
Тела запросов с JSON передавайте с `Content-Type: application/json`.

| Метод | Путь | Тело / параметры | Ответ | Токен сессии |
|---|---|---|---|---|
| POST | `/api/chat/sessions` | Без тела | `201 SessionCreated` | Нет |
| POST | `/api/chat` | `ChatRequest` | `200 ChatResponse` | Да |
| POST | `/api/chat/upload` | Query `session_id`, сырые байты, `X-Filename` | `200 ChatResponse` | Да |
| GET | `/api/products/{product_id}` | ID из карточки | `200 Product` | Нет |
| GET | `/api/cart` | Query `session_id` | `200 CartResponse` | Да |
| POST | `/api/cart/items` | `CartConfirmation` | `200 CartResult` | Да |
| GET | `/api/health/live` | — | `200 {"status":"ok"}` | Нет |
| GET | `/api/health/ready` | — | `200 {"status":"ok","redis":"ok"}` | Нет |
| GET | `/api/health` | Алиас `/health/ready` | То же | Нет |

Health не требует и API-ключа. Readiness проверяет Redis; успешный ответ не
означает, что credentials OpenAI/EKT действительны или ClamAV готов.

Маршруты `/api/items` удалены. `/api/cart/items` — отдельная операция
подтверждения корзины и остаётся доступной. Публичных endpoints поиска,
истории чата, редактирования/удаления строк корзины, оформления заказа,
продления/удаления сессии, SSE и WebSocket сейчас нет. Поиск выполняется
сообщением в чат. Ответ чата приходит целиком одним JSON после завершения хода.

## 3. Сессия и отправка сообщений

### Создание

Отправьте `POST /api/chat/sessions` один раз при открытии нового диалога:

```json
{
  "session_id": "41333b62-41bd-4fcf-8d98-4954f4bf291a",
  "session_token": "<непрозрачный секретный токен из ответа>",
  "expires_in": 3600
}
```

Сохраните ID и токен совместно. Токен возвращается только при создании;
получить его повторно из backend нельзя. Значение `expires_in` задаёт TTL в
секундах и зависит от `CHAT_SESSION_TTL_SECONDS`.

По умолчанию сессия живёт **3600 секунд после последнего успешного запроса к
этой сессии**: chat, upload, GET cart или подтверждение корзины. Чтение продукта
TTL не продлевает. При `404 session_not_found` очистите текущую корзину и
предложение, сообщите об истечении диалога и создайте новую сессию. Точный срок
последующего истечения API не возвращает; локальный таймер — только подсказка.

Один запрос на сессию обрабатывается за раз. Пока идёт ответ чата, блокируйте
повторную отправку, вложения, подтверждение и фоновый GET cart. Иначе возможен
`409 session_busy`, в том числе между вкладками. Запросы к разным сессиям
независимы. Обработка по умолчанию ограничена 90 секундами
(`CHAT_TIMEOUT_SECONDS`); таймаут BFF должен позволять дождаться результата.

### Сообщение

`POST /api/chat` с `X-API-Key` и `X-Session-Token`:

```json
{
  "session_id": "41333b62-41bd-4fcf-8d98-4954f4bf291a",
  "message": "Найди кабель ВВГнг 3x2.5"
}
```

`message`: 1–8000 символов после удаления пробелов по краям. Неизвестные поля
запрещены. Дополнительно действует ограничение JSON-тела — по умолчанию
16384 байта (`MAX_REQUEST_BYTES`), поэтому 8000 символов Unicode не всегда
поместятся. Историю отправлять не нужно: backend сам хранит её по TTL.

Пример формы ответа без результатов поиска:

```json
{
  "session_id": "41333b62-41bd-4fcf-8d98-4954f4bf291a",
  "message": "Уточните артикул или характеристики товара.",
  "cart_changed": false,
  "pending_cart_action": null,
  "products": [],
  "analogs": [],
  "external_variants": [],
  "extracted": [],
  "cart": null,
  "cart_url": null,
  "demo_cart": true
}
```

При получении ответа интерфейс:

1. Добавляет `message` в ленту ассистента и отображает структурированные карточки.
2. Заменяет текущее предложение на `pending_cart_action`, включая `null`.
3. Если `cart` не `null`, заменяет локальное состояние корзины этим объектом.
4. Если `cart_changed: true`, показывает подтверждение добавления.
5. Снимает состояние ожидания. Пустой `products` — допустимый ответ.

`cart: null` означает отсутствие объекта корзины в этом ответе, а не пустую
корзину. Нельзя по нему обнулять ранее полученное состояние. Карточки относятся
к текущему ответу; ленту интерфейс хранит самостоятельно в памяти. Backend
хранит ограниченный контекст (`CHAT_MAX_MESSAGES`, по умолчанию 40 сообщений),
но отдельного HTTP-чтения истории нет.

`message` уже HTML-экранирован сервером; это не HTML-разметка. Все текстовые
поля выводите как текст, не через `innerHTML`/`dangerouslySetInnerHTML`.
Структурированные названия и характеристики также считаются внешними данными.
Ссылки открывайте только после проверки допустимого протокола HTTP(S).

## 4. Карточки, аналоги и endpoint products

Используйте `products` из ответа чата для первого показа. Не нужно немедленно
перезапрашивать каждую карточку: backend уже обновляет детали перед выдачей
результатов поиска и аналогов.

`GET /api/products/{product_id}` нужен для кнопки **«Подробнее»**, открытия
карточки по известному ID или явного обновления цены/остатка. Путь принимает
`Product.id`, не `article`; кодируйте сегмент через `encodeURIComponent`.
Требуется только API-ключ BFF. Запрос не создаёт предложение, не добавляет товар
в корзину и не продлевает сессию. Детали всегда запрашиваются свежими;
параметра `fresh` у HTTP API нет.

Учебный пример `Product` (значения не являются реальными данными каталога):

```json
{
  "id": "example-product-1",
  "name": "Пример товара",
  "article": "EXAMPLE-001",
  "brand": null,
  "category": null,
  "description": null,
  "price": "850.00",
  "quantity": "12.5",
  "stores": [{"name": "Пример склада", "quantity": "12.5"}],
  "attributes": {"Сечение": "2.5"},
  "certificates": [],
  "product_url": null,
  "source": "ekt_catalog"
}
```

Цены, остатки и суммы типа Decimal сериализуются **строками**. Остаток может
быть дробным, количество добавления — только целым. `null` означает «неизвестно»,
а `"0"` — известное нулевое значение; не заменяйте одно другим. Поля валюты в
контракте нет. Не придумывайте валюту по числу и не пересчитывайте итог через
обычные операции JavaScript с дробными числами: выводите серверный `total_amount`
или используйте decimal-арифметику.

`analogs` содержит товары EKT с `match`, `differences`, `unknown`, оценкой
`score` от 0 до 1 и `recommendation`. Показывайте отличия и неизвестные параметры
рядом с вариантом. Оценка не подтверждает полную взаимозаменяемость.

`external_variants` — внешние источники, не товары каталога EKT. У них нет
backend `product_id`, все имеют `recommendation: "requires_review"`. Не
предлагайте добавление такого варианта в корзину через `/api/cart/items`.
Внешний поиск по умолчанию отключён (`EXTERNAL_SEARCH_ENABLED=false`).

## 5. Корзина: предложение → подтверждение → результат

### Получить предложение

Отправьте в чат запрос, например «Добавь 2 штуки товара с артикулом …».
Backend сначала проверяет товар и может вернуть `pending_cart_action`.
У frontend нет отдельного HTTP endpoint для создания предложения.
Не создавайте `operation_id` самостоятельно.

Учебный пример предложения:

```json
{
  "operation_id": "ab8f3a9a-e95b-4b4a-a9a5-d03289445e2e",
  "product_id": "example-product-1",
  "product_name": "Пример товара",
  "quantity": 2,
  "price_at_proposal": "850.00",
  "available_quantity": "12.5",
  "status": "WAITING_CONFIRMATION",
  "expires_at": "2030-01-01T12:10:00Z",
  "requires_confirmation": true,
  "demo": true
}
```

Покажите название, количество, цену и кнопки **«Подтвердить»** / **«Отмена»**.
До подтверждения корзина не меняется. `expires_at` — UTC; по истечении отключите
кнопку и предложите запросить новое предложение. По умолчанию срок — 600 секунд.
Одновременно активно только одно предложение. Новое заменяет старое; в старых
сообщениях ленты кнопку подтверждения нужно отключить.

### Подтвердить кнопкой

`POST /api/cart/items` с обоими заголовками авторизации. Передавайте **точно**
`operation_id`, `product_id` и `quantity` последнего предложения:

```json
{
  "session_id": "41333b62-41bd-4fcf-8d98-4954f4bf291a",
  "operation_id": "ab8f3a9a-e95b-4b4a-a9a5-d03289445e2e",
  "product_id": "example-product-1",
  "quantity": 2
}
```

Цена в запросе не принимается. `quantity` — JSON-число, строго целое от 1 до
2147483647; строка `"2"`, `2.5` и `true` недопустимы. Для изменения количества
запросите новое предложение через чат и получите новое явное подтверждение.

Backend повторно проверяет цену и остаток с учётом уже добавленного количества.
У HTTP `200` есть **два разных результата**:

| `status` | `success` | Что делает UI |
|---|---|---|
| `added` | `true` | Заменить корзину из `cart`, убрать подтверждённое предложение, сообщить об успехе |
| `reconfirmation_required` | `false` | Показать `message`, заменить предложение на новое, снова ждать пользователя |

При `reconfirmation_required` старый товар автоматически не добавляется.
`pending_cart_action` может быть `null`, если доступного количества больше нет.
Если предложение есть, покажите новую цену/количество и повторную кнопку;
не отправляйте её автоматически. HTTP `200` сам по себе не означает добавление.

Повтор POST с тем же `operation_id`, товаром и количеством не добавляет товар
дважды в течение жизни сессии; возвращается актуальная корзина. При сетевой
ошибке сохраните исходное тело и повторяйте именно его. Изменённое тело с тем
же operation ID вызывает `409 cart_conflict`. Идемпотентность относится к
`POST /api/cart/items`, а не ко всем сообщениям чата.

### Подтвердить текстом или отменить

В `/api/chat` распознаются точные короткие команды с обычной пунктуацией:

| Сообщение | Результат |
|---|---|
| `да`, `да, добавь`, `добавь` | Подтверждение активного предложения |
| `да, добавь 5` | При другом количестве — новое предложение; нужно ещё раз подтвердить |
| `нет`, `отмена`, `не надо` | Отмена предложения, уже добавленная корзина сохраняется |
| `да` без предложения | Просьба уточнить товар/количество |
| `добавь другой товар` | Отмена предложения и продолжение поиска |

Кнопку отмены можно реализовать сообщением `"отмена"`. Учитывайте, что оно
попадёт в историю чата. Новое вложение также отменяет активное предложение при
успешной обработке. При смене товара актуальное предложение берите из нового
ответа, а не из старой карточки.

### Показать корзину

`GET /api/cart?session_id=...` с обоими заголовками возвращает:

```json
{
  "items": [],
  "total_quantity": 0,
  "total_amount": "0",
  "cart_url": "/api/cart?session_id=41333b62-41bd-4fcf-8d98-4954f4bf291a",
  "demo": true
}
```

`total_quantity` — сумма количества, не число разных строк. При добавлении
того же товара количество увеличивается; строка получает актуальную
подтверждённую цену. Полученная корзина не является счётом или резервом.

`cart_url` — путь защищённого API, **не страница корзины ekt.kz**. Обычный `<a>`
не передаёт нужные заголовки. Кнопка «Открыть корзину» должна открывать ваш UI
и вызывать `GET /api/cart` через BFF. Endpoint изменения/удаления строки и
checkout в этой версии отсутствуют.

## 6. Вложения

Отправка: `POST /api/chat/upload?session_id=...` с сырыми байтами файла в теле.
Обязательные заголовки: `X-API-Key`, `X-Session-Token`, `X-Filename`, `Content-Type`.
Это **не FormData/multipart**, не JSON и не base64 от браузера.

| Расширение | Content-Type |
|---|---|
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.pdf` | `application/pdf` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |

По умолчанию максимум `20 * 1024 * 1024` байт, конфигурация `MAX_UPLOAD_MB` может
уменьшать лимит. Один запрос — один непустой файл. `X-Filename` — 1–200 символов,
расширение должно соответствовать содержимому и MIME. Для совместимости HTTP
передавайте ASCII-имя `attachment.pdf` с правильным расширением; оригинальное
имя можно показывать локально в интерфейсе.

Проверяйте размер и разрешённый формат до отправки, но окончательное решение
принимает backend: он проверяет содержимое, ограничения изображений и архивов,
затем ClamAV. Документы с неподдерживаемым активным содержимым или внешними
связями могут быть отклонены. Без доступного сканера загрузка закрыта:
`503 upload_scanner_unavailable`. Текстовый чат от него не зависит.

Ответ имеет тот же тип `ChatResponse`, что и обычный текстовый ход. `extracted`
содержит распознанные поля, `confidence`, `unreadable_fields`. Значение
`confidence < 0.65` нельзя показывать как подтверждённую идентификацию товара.
Для карточек каталога используйте `products`, а не выводите распознанный артикул
как автоматически существующий товар EKT.

Вложения обрабатываются в памяти и не имеют постоянного URL. Нет endpoint
скачивания/предпросмотра ранее загруженного файла. Для локального предпросмотра
можно использовать `URL.createObjectURL(file)` и освобождать URL при закрытии.

## 7. TypeScript-типы

UUID, Decimal и UTC datetime передаются строками. Следующие типы описывают JSON
API. Это типизация клиента; при необходимости runtime-проверки добавьте
валидацию ответа или генерируйте типы из OpenAPI.

```ts
type UUID = string;
type DecimalString = string;
type ISODateTime = string;

interface SessionCreated {
  session_id: UUID;
  session_token: string;
  expires_in: number;
}
interface ChatRequest { session_id: UUID; message: string }
interface CartConfirmation {
  session_id: UUID;
  operation_id: UUID;
  product_id: string;
  quantity: number;
}
interface Product {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  price: DecimalString | null;
  quantity: DecimalString | null;
  stores: Array<{ name: string; quantity: DecimalString | null }>;
  attributes: Record<string, string>;
  certificates: Array<{ name: string | null; url: string }>;
  product_url: string | null;
  source: "ekt_catalog";
}
interface Analog {
  kind: "catalog_analog";
  product_id: string;
  product: Product;
  score: number;
  match: string[];
  differences: string[];
  unknown: string[];
  quantity: DecimalString | null;
  recommendation: "possible_alternative" | "requires_review";
}
interface Attribute { name: string; value: string }
interface IdentifiedProduct {
  article: string | null;
  barcode: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  attributes: Attribute[];
  quantity: number | null;
  unreadable_fields: string[];
  confidence: number;
}
interface ExternalVariant {
  name: string;
  url: string;
  attributes: Attribute[];
  differences: string[];
  unknown: string[];
  kind: "external_variant";
  recommendation: "requires_review";
}
interface PendingCartAction {
  operation_id: UUID;
  product_id: string;
  product_name: string;
  quantity: number;
  price_at_proposal: DecimalString;
  available_quantity: DecimalString;
  status: "WAITING_CONFIRMATION";
  expires_at: ISODateTime;
  requires_confirmation: true;
  demo: true;
}
interface CartLine {
  product_id: string;
  product_name: string;
  quantity: number;
  price: DecimalString;
}
interface CartResponse {
  items: CartLine[];
  total_quantity: number;
  total_amount: DecimalString;
  cart_url: string;
  demo: true;
}
interface CartResult {
  operation_id: UUID;
  product_id: string;
  quantity: number;
  status: "added" | "reconfirmation_required";
  message: string;
  cart: CartResponse;
  pending_cart_action: PendingCartAction | null;
  demo: true;
  success: boolean;
  cart_url: string;
}
interface ChatResponse {
  session_id: UUID;
  message: string;
  cart_changed: boolean;
  pending_cart_action: PendingCartAction | null;
  products: Product[];
  analogs: Analog[];
  external_variants: ExternalVariant[];
  extracted: IdentifiedProduct[];
  cart: CartResponse | null;
  cart_url: string | null;
  demo_cart: true;
}
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: Array<{ location: Array<string | number>; type: string }>;
  };
  request_id: string;
}
```

## 8. Пример браузерного fetch-клиента через BFF

Это пример для frontend-проекта, **не уже существующий маршрут репозитория**.
Предположим, вы настроили BFF так, что `/backend/api/*` проксирует в `/api/*`
FastAPI, добавляет серверный `X-API-Key` и проверяет пользовательский доступ.
Клиент ниже не содержит API-ключа, хранит токен только в памяти и не выполняет
автоматических повторов. Используйте вместе с типами выше.

```ts
class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const uploadMime: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

class ChatClient {
  private session: SessionCreated | null = null;
  private busy = false;

  constructor(private readonly base = "/backend/api") {}

  private async request<T>(
    path: string,
    init: RequestInit = {},
    sessionToken?: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("X-Request-ID", crypto.randomUUID());
    if (sessionToken) headers.set("X-Session-Token", sessionToken);
    // X-API-Key добавляет только сервер BFF.
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // Прокси может вернуть HTML/пустое тело, поэтому JSON не гарантирован.
      const errorBody = body as Partial<ErrorResponse> | null;
      const code = errorBody?.error?.code ?? "http_error";
      if (code === "session_not_found" || code === "session_unauthorized") {
        this.session = null;
      }
      throw new ApiError(
        response.status,
        code,
        errorBody?.error?.message ?? "Не удалось выполнить запрос",
        errorBody?.request_id ?? response.headers.get("X-Request-ID"),
      );
    }
    if (body === null) throw new Error("Backend вернул пустой или невалидный JSON");
    return body as T;
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Дождитесь завершения текущего запроса");
    this.busy = true;
    try { return await work(); }
    finally { this.busy = false; }
  }

  private current(): SessionCreated {
    if (!this.session) throw new Error("Сначала создайте сессию");
    return this.session;
  }

  async start(): Promise<SessionCreated> {
    return this.exclusive(async () => {
      const session = await this.request<SessionCreated>("/chat/sessions", {
        method: "POST",
      });
      this.session = session;
      return { ...session };
    });
  }

  async send(message: string): Promise<ChatResponse> {
    return this.exclusive(async () => {
      const session = this.current();
      return this.request<ChatResponse>("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.session_id, message }),
      }, session.session_token);
    });
  }

  async upload(file: File, maxBytes = 20 * 1024 * 1024): Promise<ChatResponse> {
    return this.exclusive(async () => {
      const session = this.current();
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const mime = uploadMime[extension];
      if (!mime || file.size === 0 || file.size > maxBytes) {
        throw new Error("Неподдерживаемый формат или размер файла");
      }
      return this.request<ChatResponse>(
        `/chat/upload?session_id=${encodeURIComponent(session.session_id)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": mime,
            "X-Filename": `attachment.${extension}`,
          },
          body: file,
        },
        session.session_token,
      );
    });
  }

  async getProduct(productId: string): Promise<Product> {
    return this.request<Product>(`/products/${encodeURIComponent(productId)}`);
  }

  async getCart(): Promise<CartResponse> {
    return this.exclusive(async () => {
      const session = this.current();
      return this.request<CartResponse>(
        `/cart?session_id=${encodeURIComponent(session.session_id)}`,
        {}, session.session_token,
      );
    });
  }

  async confirm(proposal: PendingCartAction): Promise<CartResult> {
    return this.exclusive(async () => {
      const session = this.current();
      const body: CartConfirmation = {
        session_id: session.session_id,
        operation_id: proposal.operation_id,
        product_id: proposal.product_id,
        quantity: proposal.quantity,
      };
      return this.request<CartResult>("/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, session.session_token);
    });
  }

  async cancelProposal(): Promise<ChatResponse> {
    return this.send("отмена");
  }
}

// Один экземпляр на активный диалог. Не вызывайте start() на каждое сообщение.
const chat = new ChatClient();
await chat.start();
const answer = await chat.send("Найди кабель ВВГнг 3x2.5");
// Отрисуйте answer.message, answer.products и answer.pending_cart_action.
// Только после клика пользователя вызывайте chat.confirm(показанноеПредложение).
```

В UI храните `loading`, `messages`, `products`, `pendingProposal`, `cart`,
`lastError`. Запросы выполняйте в `try/catch/finally`, чтобы всегда снимать
индикатор. После `CartResult` присваивайте `cart = result.cart` и
`pendingProposal = result.pending_cart_action`, затем проверяйте `result.status`.

Отключение кнопки и локальная блокировка предотвращают двойной клик, но не
заменяют серверную обработку `session_busy` и повторов подтверждения. Закрытие
вкладки или `AbortController.abort()` не гарантирует отмену уже начатой операции
на сервере. Не повторяйте текстовый ход автоматически после неопределённого
сетевого результата. Для подтверждения сохраняйте исходное предложение для
идемпотентного повтора в той же сессии.

## 9. Ошибки и поведение интерфейса

Стандартный формат ошибки приложения:

```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session does not exist or has expired.",
    "details": []
  },
  "request_id": "b65e8ef4908746e384b01f10f2538c7e"
}
```

`X-Request-ID` приходит в заголовке ответа; ошибки содержат его и в JSON.
Сохраняйте ID для обращения к разработчику, без токенов и текста диалога.
Клиентский ID может состоять из букв ASCII, цифр, `_`, `.`, `-`, длина 1–64.
Невалидный или отсутствующий ID backend заменяет своим.

| HTTP / `error.code` | Что произошло | Действие UI |
|---|---|---|
| 401 `authentication_required` | Неверный/отсутствующий ключ BFF | Ошибка настройки, не просить пользователя вводить серверный ключ |
| 401 `session_unauthorized` | Неверный/отсутствующий токен сессии | Очистить локальный доступ, начать новую сессию; проверить передачу заголовка BFF |
| 404 `session_not_found` | Истекла/потеряна сессия | Сообщить о потере временного состояния, создать новую |
| 404 `product_not_found` | Товар отсутствует в каталоге | Убрать действие над устаревшей карточкой, предложить новый поиск |
| 409 `session_busy` | Сессия занята другим запросом | Дождаться завершения; не создавать ещё один параллельный запрос |
| 409 `cart_conflict` | Нет подходящего предложения, истёк срок, нарушены лимиты | Снять активное подтверждение, показать причину и запросить новое предложение |
| 413 `request_too_large`, `attachment_too_large` | Превышен размер тела/файла | Предложить уменьшить текст или файл |
| 422 `validation_error` | Неверное тело/UUID/заголовок/лишнее поле | Исправить запрос; `details[].location` и `type` указывают причину |
| 422 `invalid_attachment` | Файл/формат/проверка безопасности не прошли | Предложить другой файл или ввод артикула текстом |
| 502 `upstream_unavailable` | Ошибка/таймаут/невалидный ответ внешней системы | Сохранить введённый текст, показать временную ошибку, дать ручной повтор |
| 503 `integration_not_configured` | Нет необходимых внешних credentials | Сообщить о недоступности функции; исправляется на backend |
| 503 `upload_scanner_unavailable` | Сканер отсутствует или не готов | Временно отключить вложения, оставить текстовый ввод |
| 503 `storage_unavailable` | Redis недоступен | Показать временную ошибку; после восстановления сессия может быть потеряна |
| 500 `internal_error` | Неожиданная ошибка backend | Показать нейтральное сообщение и request ID |

`error.message` может быть на русском или английском: локализуйте основные
сообщения по `error.code`. Не разбирайте текст сообщения как протокол.
Неверный host, reverse proxy и сетевые сбои могут возвращать не этот JSON;
предусмотрите общий fallback. Ответы имеют `Cache-Control: no-store`.

## 10. CORS и настройки для frontend-команды

При схеме браузер → BFF на том же origin → FastAPI CORS между браузером и
FastAPI не нужен. `CORS_ORIGINS` backend по умолчанию `[]`.

Если браузер в контролируемой среде обращается непосредственно к FastAPI,
укажите точные разрешённые origins, например:

```env
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]
ALLOWED_HOSTS=["localhost","127.0.0.1","api.example.com"]
```

Origin включает схему и порт; `localhost` и `127.0.0.1` — разные origins.
`ALLOWED_HOSTS` содержит хосты **без** схемы/порта. CORS не заменяет авторизацию
и не делает размещение API-ключа в публичном браузере допустимым. Backend
настроен с `allow_credentials=false`; cookie BFF не является cookie FastAPI.
Заголовки `Content-Type`, `X-API-Key`, `X-Session-Token`, `X-Filename` и
`X-Request-ID` разрешены. `X-Request-ID` доступен JavaScript в CORS-ответе.

Перед согласованием UI уточните у backend-команды фактические значения:

| Настройка | По умолчанию | Влияние на frontend |
|---|---|---|
| `API_PREFIX` | `/api` | Настройка адреса прокси |
| `CHAT_SESSION_TTL_SECONDS` | 3600 | Потеря состояния при неактивности |
| `CHAT_TIMEOUT_SECONDS` | 90 | Продолжительность ожидания, timeout BFF |
| `CART_PROPOSAL_TTL_SECONDS` | 600 | Время доступности подтверждения |
| `MAX_REQUEST_BYTES` | 16384 | Максимальное JSON-тело |
| `MAX_UPLOAD_MB` | 20 | Ограничение выбора файла |
| `UPLOAD_SCAN_HOST` | Не задан | Без сканера вложения недоступны |
| `EXTERNAL_SEARCH_ENABLED` | false | Внешние варианты могут отсутствовать |

Сессии, история и корзины исчезают при TTL или перезапуске Redis. Вложения
не сохраняются на диск backend. Не обещайте пользователю восстановление
истории или корзины после истечения сессии.

## 11. Чеклист ручной приёмки

- Создание сессии возвращает `201`; последующее сообщение использует её ID и токен.
- Один ход отображает текст, карточки и аналоги без дополнительного GET на каждую карточку.
- «Подробнее» использует `Product.id` и показывает свежую карточку или понятный `404`.
- Во время обработки повторная отправка и конкурирующий GET корзины не запускаются.
- Предложение само не меняет корзину; подтверждение использует точные поля сервера.
- Повтор одного подтверждения не увеличивает количество второй раз.
- `reconfirmation_required` требует нового клика, даже при HTTP `200`.
- Истёкшее/отменённое/заменённое предложение больше нельзя подтвердить из старой карточки.
- Корзина обозначена как демонстрационная; `cart_url` не используется как обычная веб-ссылка.
- JPEG/PNG/PDF/DOCX/XLSX отправляются сырым телом с правильными заголовками.
- Нет сканера / большой файл / неверный формат дают понятные сообщения.
- `null` цены/остатка показан как неизвестное значение, `"0"` — как ноль.
- Истечение сессии и перезапуск Redis очищают локальную корзину после ошибки сессии.
- В браузерной сборке, аналитике и логах нет серверных ключей и session token.
- Ошибка сети или не-JSON ответ прокси не ломает UI и не вызывает бесконечных повторов.

Автотесты backend используют mocks внешних сервисов. Полный smoke-test с чатом
и реальным артикулом EKT выполняйте в настроенном окружении через Swagger или
ваш BFF; успешный healthcheck сам по себе эти интеграции не проверяет.
