# Strikers Club Backend

Асинхронный backend на **Python 3.11+, FastAPI, Pydantic Settings и redis-py** для
чата ekt.kz: поиск товаров, свежие карточки каталога, подбор аналогов, обработка
вложений и демонстрационная корзина с явным подтверждением.

Пользовательские данные хранятся только временно в Redis с TTL. Вложения
обрабатываются в памяти. Перезапуск Redis удаляет сессии, историю и корзины.
Официальная корзина ekt.kz и оформление заказов не подключены.

- **Для frontend-разработчика:** [интеграция, сценарии UI и TypeScript-клиент](docs/FRONTEND_INTEGRATION.md).
- **Для backend-разработчика:** [настройка интеграций и контракт чата](docs/CHAT_API.md).
- **Все настройки:** [.env.example](.env.example).

## Запуск

Если `.env` уже существует, не перезаписывайте его. Для первого запуска:

```bash
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Запишите сгенерированный секрет в `API_KEY`. Для чата и каталога также заполните
`OPENAI_API_KEY`, `EKT_API_USER`, `EKT_API_PASSWORD`.

```bash
docker compose up --build -d
curl http://localhost:8000/api/health/ready
```

Если установленный Docker не собирает образ без Buildx:

```bash
COMPOSE_BAKE=false DOCKER_BUILDKIT=0 docker compose up --build -d
```

API: `http://localhost:8000`. Swagger: `http://localhost:8000/docs` — **Authorize**
принимает `API_KEY`. В `ENVIRONMENT=production` Swagger и OpenAPI отключены.
После изменения `.env` пересоздайте контейнер:

```bash
docker compose up -d --no-deps --force-recreate api
```

Для вложений задайте `UPLOAD_SCAN_HOST=clamav` и запустите антивирус:

```bash
docker compose --profile uploads up --build -d
```

До готовности ClamAV загрузка файлов возвращает `503 upload_scanner_unavailable`.
Текстовый чат может работать без антивируса.

```bash
docker compose logs -f api
docker compose down
```

## HTTP API

Префикс по умолчанию — `/api`; он задаётся `API_PREFIX`.

| Метод | Путь | Назначение | Авторизация |
|---|---|---|---|
| POST | `/api/chat/sessions` | Создать временную сессию | `X-API-Key` |
| POST | `/api/chat` | Отправить сообщение | API-ключ + `X-Session-Token` |
| POST | `/api/chat/upload?session_id=…` | Отправить файл сырым телом | API-ключ + токен сессии |
| GET | `/api/products/{product_id}` | Обновить карточку товара EKT | `X-API-Key` |
| POST | `/api/cart/items` | Подтвердить предложение корзины | API-ключ + токен сессии |
| GET | `/api/cart?session_id=…` | Получить демонстрационную корзину | API-ключ + токен сессии |
| GET | `/api/health/live` | Проверить процесс | Без авторизации |
| GET | `/api/health/ready` | Проверить Redis | Без авторизации |
| GET | `/api/health` | Алиас readiness | Без авторизации |

Маршруты `/api/items` удалены. `/api/cart/items` остаётся: это подтверждение
предложения корзины, описанное в [руководстве фронтенда](docs/FRONTEND_INTEGRATION.md).

`API_KEY` — секрет серверного клиента: публичный браузер обращается через
доверенный BFF/серверный прокси, который добавляет ключ. Не включайте секреты
backend, OpenAI и EKT в frontend-сборку. BFF в этот репозиторий не входит.

## Структура

```text
app/
├── main.py                        # фабрика FastAPI, lifespan, middleware
├── core/                          # настройки, Redis, безопасность, JSON-логи
├── api/
│   ├── errors.py                  # единый формат ошибок
│   ├── middleware.py              # request ID, размеры запросов
│   └── routes/                    # chat, products, cart, health
├── clients/                       # HTTP-клиенты OpenAI и EKT
├── services/                      # чат, каталог, аналоги, корзина, вложения
├── repositories/chat_sessions.py  # сессии, TTL, токены, Redis-блокировки
├── schemas/                       # схемы HTTP и structured output
├── models/                        # товары, сессия и демонстрационная корзина
└── data/                          # профили категорий, условия покупки
docs/FRONTEND_INTEGRATION.md        # договор интеграции и примеры для UI
docs/CHAT_API.md                    # настройка и детали реализации
tests/                            # API, сессии, внешние контракты и ошибки
Dockerfile                        # multi-stage, non-root
docker-compose.yml                # API + Redis; профиль uploads с ClamAV
.env.example                      # шаблон без действующих секретов
pyproject.toml                    # зависимости, pytest, Ruff, strict mypy
requirements.lock                 # runtime-зависимости с версиями и хешами
requirements-dev.lock             # зависимости разработки с хешами
.github/workflows/ci.yml           # автоматические проверки
```

HTTP-слой вызывает сервисы; сервисы используют репозиторий сессий и клиенты
внешних систем. Постоянной БД и ORM нет. Redis в Compose работает с отключёнными
RDB/AOF и `/data` в tmpfs. Внешний Redis должен быть настроен аналогично;
приложение не меняет его настройки. Поддерживается один Redis instance;
Redis Cluster не поддерживается. Ответы API имеют `Cache-Control: no-store`.

Для публикации настройте HTTPS reverse proxy, ограничение частоты запросов и
доверенный домен в `ALLOWED_HOSTS`; оставьте `127.0.0.1` для Docker healthcheck.
JSON-логи содержат маршрут, статус, длительность и request ID; тела запросов и
секреты не логируются.

## Локальная разработка и проверки

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements-dev.lock
```

В отдельном терминале запустите временный Redis:

```bash
docker run --rm --name strikers-redis-dev -p 127.0.0.1:6379:6379 \
  --tmpfs /data redis:7.4-alpine redis-server --save '' --appendonly no \
  --maxmemory 128mb --maxmemory-policy noeviction
```

В терминале с активированным venv и настроенным `.env`:

```bash
uvicorn app.main:create_app --factory --reload --no-access-log --no-proxy-headers
```

Проверки:

```bash
python -m pytest -q
ruff check .
ruff format --check .
mypy app

# Дополнительный прогон с отдельным тестовым Redis:
TEST_REDIS_URL=redis://127.0.0.1:6379/0 python -m pytest -q
```

По умолчанию Redis заменён на fakeredis с Lua, а OpenAI/EKT — HTTP mocks.
Тесты проверяют сессии, подтверждение корзины, идемпотентность, свежесть каталога,
обработку вложений, авторизацию и ошибки. Их успех не проверяет действительность
внешних credentials. Для ручной проверки используйте сценарии из
[руководства фронтенда](docs/FRONTEND_INTEGRATION.md).
