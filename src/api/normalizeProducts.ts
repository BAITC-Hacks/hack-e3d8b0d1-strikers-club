import type { Analog, Attribute, ExternalVariant, IdentifiedProduct, Product } from './types';
import {
  array,
  invalid,
  literal,
  nullableDecimal,
  nullableText,
  nonNegative,
  object,
  probability,
  string,
  text,
  textArray,
} from './validation';

export function normalizeProduct(value: unknown): Product {
  const item = object(value, 'товар');
  return {
    id: text(item.id, 'идентификатор товара'),
    name: text(item.name, 'название товара'),
    article: nullableText(item.article, 'article'),
    brand: nullableText(item.brand, 'brand'),
    category: nullableText(item.category, 'category'),
    description: nullableText(item.description, 'description'),
    price: nullableDecimal(item.price, 'цена товара'),
    quantity: nullableDecimal(item.quantity, 'остаток товара'),
    attributes: Object.fromEntries(
      Object.entries(object(item.attributes, 'attributes')).map(([key, value]) => [
        key,
        string(value, key),
      ]),
    ),
    stores: array(item.stores, 'stores').map((entry) => {
      const store = object(entry, 'склад');
      return {
        name: text(store.name, 'название склада'),
        quantity: nullableDecimal(store.quantity, 'остаток на складе'),
      };
    }),
    certificates: array(item.certificates, 'certificates').map((entry) => {
      const certificate = object(entry, 'сертификат');
      return {
        name: nullableText(certificate.name, 'название сертификата'),
        url: text(certificate.url, 'ссылка на сертификат'),
      };
    }),
    product_url: nullableText(item.product_url, 'product_url'),
    source: literal(item.source, 'ekt_catalog', 'source'),
  };
}

function normalizeAttributes(value: unknown): Attribute[] {
  return array(value, 'attributes').map((entry) => {
    const item = object(entry, 'атрибут');
    return {
      name: text(item.name, 'attribute.name'),
      value: string(item.value, 'attribute.value'),
    };
  });
}

export function normalizeAnalog(value: unknown): Analog {
  const item = object(value, 'аналог');
  const recommendation = item.recommendation;
  if (recommendation !== 'possible_alternative' && recommendation !== 'requires_review')
    return invalid('recommendation');
  return {
    kind: literal(item.kind, 'catalog_analog', 'kind'),
    product_id: text(item.product_id, 'product_id'),
    product: normalizeProduct(item.product),
    score: probability(item.score, 'score'),
    match: textArray(item.match, 'match'),
    differences: textArray(item.differences, 'differences'),
    unknown: textArray(item.unknown, 'unknown'),
    quantity: nullableDecimal(item.quantity, 'остаток аналога'),
    recommendation,
  };
}

export function normalizeExternalVariant(value: unknown): ExternalVariant {
  const item = object(value, 'внешний вариант');
  return {
    name: text(item.name, 'название внешнего варианта'),
    url: text(item.url, 'url'),
    attributes: normalizeAttributes(item.attributes),
    differences: textArray(item.differences, 'differences'),
    unknown: textArray(item.unknown, 'unknown'),
    kind: literal(item.kind, 'external_variant', 'kind'),
    recommendation: literal(item.recommendation, 'requires_review', 'recommendation'),
  };
}

export function normalizeIdentifiedProduct(value: unknown): IdentifiedProduct {
  const item = object(value, 'распознанный товар');
  return {
    article: nullableText(item.article, 'article'),
    barcode: nullableText(item.barcode, 'barcode'),
    brand: nullableText(item.brand, 'brand'),
    model: nullableText(item.model, 'model'),
    category: nullableText(item.category, 'category'),
    attributes: normalizeAttributes(item.attributes),
    quantity: item.quantity === null ? null : nonNegative(item.quantity, 'распознанное количество'),
    unreadable_fields: textArray(item.unreadable_fields, 'unreadable_fields'),
    confidence: probability(item.confidence, 'confidence'),
  };
}
