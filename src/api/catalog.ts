import type { Product } from './types';

const common = {
  category: 'Электротехника',
  description: null,
  product_url: null,
  source: 'ekt_catalog' as const,
  certificates: [],
};

export const catalog: Product[] = [
  {
    ...common,
    id: '515291',
    article: 'VVG-3X2.5',
    name: 'Кабель ВВГнг 3×2,5',
    brand: 'Электрокабель',
    price: '850',
    quantity: '120',
    attributes: { 'Число жил': '3', Сечение: '2,5 мм²', Материал: 'Медь', Напряжение: '660 В' },
    stores: [
      { name: 'Алматы', quantity: '80' },
      { name: 'Астана', quantity: '40' },
    ],
  },
  {
    ...common,
    id: '516001',
    article: 'ABC-123',
    name: 'Автоматический выключатель Legrand C16',
    brand: 'Legrand',
    price: '64920',
    quantity: '23',
    attributes: {
      'Номинальный ток': '16 А',
      Напряжение: '400 В',
      'Количество полюсов': '3',
      Характеристика: 'C',
    },
    stores: [
      { name: 'Алматы', quantity: '15' },
      { name: 'Астана', quantity: '8' },
    ],
  },
  {
    ...common,
    id: '516002',
    article: 'DEMO-C16',
    name: 'Автоматический выключатель C16, 3 полюса',
    brand: null,
    price: '58000',
    quantity: '0',
    attributes: {
      'Номинальный ток': '16 А',
      Напряжение: '400 В',
      'Количество полюсов': '3',
      Характеристика: 'C',
    },
    stores: [],
  },
];
