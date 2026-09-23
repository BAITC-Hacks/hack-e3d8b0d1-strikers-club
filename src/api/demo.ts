import type { AssistantApi, ChatReply } from './types';
import { catalog } from './catalog';
import { createDemoCart } from './demoCart';

const copy = <T>(value: T): T => structuredClone(value);
const normalize = (value: string) =>
  value.toLocaleLowerCase('ru').replace(/[×хx]/g, 'x').replace(/,/g, '.');

/** Explicit offline demonstration; never used as a fallback for a failing backend. */
export function createDemoApi(): AssistantApi {
  let sessionId = '';
  let state = createDemoCart(sessionId);
  function product(id: string) {
    const result = catalog.find((item) => item.id === id);
    if (!result) throw new Error('Товар не найден в демонстрационном каталоге.');
    return result;
  }
  function check(id: string) {
    if (!id || id !== sessionId) throw new Error('Демонстрационный диалог уже завершён.');
  }
  function reply(message: string, extra: Partial<ChatReply> = {}): ChatReply {
    return copy({
      session_id: sessionId,
      message,
      products: [],
      analogs: [],
      external_variants: [],
      extracted: [],
      cart_changed: false,
      pending_cart_action: null,
      cart: null,
      cart_url: null,
      demo_cart: true,
      ...extra,
    });
  }
  return {
    mode: 'demo',
    async start() {
      sessionId = crypto.randomUUID();
      state = createDemoCart(sessionId);
      return { session_id: sessionId, expires_in: 3600 };
    },
    async chat(id, message) {
      check(id);
      const query = normalize(message.trim());
      state.cancel();
      if (/^отмена/.test(query)) return reply('Добавление отменено.');
      const request = message.match(/Добавь (\d+) единиц товара с ID "([^"]+)"/);
      if (request) {
        const pending = state.prepare(product(request[2]), Number(request[1]));
        return reply('Проверьте товар и количество перед добавлением.', {
          pending_cart_action: pending,
        });
      }
      if (/достав|оплат|услови/.test(query))
        return reply(
          'В демо: оплата по счёту, самовывоз или доставка по согласованию. Это пример, действующие условия уточните у менеджера ekt.kz.',
        );
      let matches = catalog.filter(
        (item) => query.includes(normalize(item.article ?? item.id)) || query.includes(item.id),
      );
      if (!matches.length && /кабел|ввг|3x2\.5/.test(query)) matches = [catalog[0]];
      if (!matches.length && /аналог|demo-c16/.test(query)) matches = [catalog[2]];
      if (!matches.length && /автомат|выключател|legrand|легранд|c16/.test(query))
        matches = [catalog[1]];
      if (!matches.length && /каталог|товар|налич|покажи/.test(query))
        matches = catalog.slice(0, 2);
      if (matches.some((item) => item.quantity === '0'))
        return reply('Позиция отсутствует. Рассмотрите аналог и проверьте требования проекта.', {
          products: matches,
          analogs: [
            {
              kind: 'catalog_analog',
              product_id: catalog[1].id,
              product: catalog[1],
              score: 0.85,
              match: ['Ток 16 А', '3 полюса', 'Характеристика C'],
              differences: ['Другой производитель'],
              unknown: ['Совместимость с монтажной шиной'],
              quantity: catalog[1].quantity,
              recommendation: 'requires_review',
            },
          ],
        });
      return reply(
        matches.length
          ? 'Вот товары из демонстрационного каталога.'
          : 'В демо доступны кабель ВВГнг 3×2,5 и автомат Legrand ABC-123. Напишите название или артикул.',
        { products: matches },
      );
    },
    async upload(id, file) {
      check(id);
      state.cancel();
      if (!file.size) throw new Error('Файл пустой. Выберите другой файл.');
      return reply(
        `Файл «${file.name}» получен в демо. Распознавание доступно при подключённом backend. Пока напишите название или артикул товара.`,
      );
    },
    async product(id) {
      return copy(product(id));
    },
    async confirm(id, proposal) {
      check(id);
      return state.confirm(proposal);
    },
    async cart(id) {
      check(id);
      return copy(state.cart);
    },
    async health() {
      return { status: 'demo' };
    },
  };
}
