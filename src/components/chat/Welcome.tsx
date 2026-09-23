import {
  ArrowUpRight,
  FileText,
  Paperclip,
  Search,
  SlidersHorizontal,
  Sparkles,
  Truck,
  Zap,
} from 'lucide-react';
const prompts = [
  {
    icon: Search,
    title: 'Найти товар',
    detail: 'По названию или артикулу',
    query: 'Есть ли кабель ВВГнг 3x2.5?',
  },
  {
    icon: SlidersHorizontal,
    title: 'Подобрать аналог',
    detail: 'Если нужного нет в наличии',
    query: 'Подбери аналог автоматического выключателя C16',
  },
  {
    icon: FileText,
    title: 'Проверить характеристики',
    detail: 'Параметры и сертификаты',
    query: 'Покажи характеристики и сертификаты кабеля ВВГнг 3x2.5',
  },
  {
    icon: Truck,
    title: 'Узнать о доставке',
    detail: 'Оплата и условия покупки',
    query: 'Какие условия оплаты, доставки и минимальная партия?',
  },
];

export function Welcome({ send, disabled }: { send: (text: string) => void; disabled: boolean }) {
  return (
    <div className="ekt-welcome">
      <div className="ekt-welcome-symbol">
        <Zap size={33} strokeWidth={1.65} />
        <span>
          <Sparkles size={13} />
        </span>
      </div>
      <div className="ekt-eyebrow">ВАШ ЭКСПЕРТ ПО ЭЛЕКТРОТЕХНИКЕ</div>
      <h1>
        Хороший выбор начинается
        <br />с простого вопроса<span>.</span>
      </h1>
      <p>
        Найду нужный товар, проверю наличие и подберу аналог.
        <br className="ekt-desktop-break" /> Просто напишите, что ищете.
      </p>
      <div className="ekt-prompt-grid">
        {prompts.map(({ icon: Icon, title, detail, query }) => (
          <button
            className="ekt-prompt"
            key={title}
            disabled={disabled}
            onClick={() => send(query)}
          >
            <span className="ekt-prompt-icon">
              <Icon size={20} strokeWidth={1.65} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <ArrowUpRight size={16} className="ekt-prompt-arrow" />
          </button>
        ))}
      </div>
      <div className="ekt-upload-hint">
        <Paperclip size={14} />
        <span>Есть фото или спецификация? Прикрепите файл к сообщению</span>
      </div>
    </div>
  );
}
