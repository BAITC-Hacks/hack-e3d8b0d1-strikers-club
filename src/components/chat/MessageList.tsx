import { Button } from '@mui/material';
import { Check, ChevronRight, FileText, ShoppingBag, Zap } from 'lucide-react';
import type { Product } from '../../api/types';
import type { Message } from '../../state/store';
import { ProductCard } from '../ProductCard';
import { StructuredResults } from './StructuredResults';
interface Props {
  messages: Message[];
  disabled: boolean;
  pending: boolean;
  hasFiles: boolean;
  unavailableProducts?: readonly string[];
  onCart: () => void;
  onPrepare: (product: Product, quantity: number) => void;
  onDetails: (product: Product) => void;
}
export function MessageList({
  messages,
  disabled,
  pending,
  hasFiles,
  unavailableProducts = [],
  onCart,
  onPrepare,
  onDetails,
}: Props) {
  return (
    <div className="ekt-message-list" role="log" aria-label="Сообщения" aria-live="polite">
      <div className="ekt-day-label">Сегодня</div>
      {messages.map((message) => (
        <div key={message.id} className={`ekt-message ekt-message-${message.role}`}>
          {message.role === 'assistant' && (
            <div className="ekt-message-avatar">
              <Zap size={17} />
            </div>
          )}
          <div className="ekt-message-body">
            {message.role === 'assistant' && (
              <span className="ekt-message-author">Помощник ekt.kz</span>
            )}
            <div className={`ekt-bubble ${message.error ? 'ekt-bubble-error' : ''}`}>
              {message.files?.map((name, index) => (
                <span className="ekt-sent-file" key={`${name}-${index}`}>
                  <FileText size={16} />
                  {name}
                </span>
              ))}
              {message.text && <p>{message.text}</p>}
              {message.cartLink && (
                <Button
                  size="small"
                  startIcon={<ShoppingBag size={16} />}
                  disabled={disabled}
                  onClick={onCart}
                >
                  Открыть корзину <ChevronRight size={16} />
                </Button>
              )}
            </div>
            {message.products && message.products.length > 0 && (
              <div className="ekt-products">
                {message.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    unavailable={unavailableProducts.includes(product.id)}
                    disabled={disabled}
                    onPrepare={onPrepare}
                    onDetails={onDetails}
                  />
                ))}
              </div>
            )}
            <StructuredResults
              analogs={message.analogs}
              externalVariants={message.external_variants}
              extracted={message.extracted}
              unavailableProducts={unavailableProducts}
              disabled={disabled}
              onPrepare={onPrepare}
              onDetails={onDetails}
            />
            {message.role === 'user' && (
              <span className="ekt-message-sent">
                Отправлено <Check size={11} />
              </span>
            )}
          </div>
        </div>
      ))}
      {pending && (
        <div className="ekt-typing">
          <div className="ekt-message-avatar">
            <Zap size={17} />
          </div>
          <span>
            <i />
            <i />
            <i />
          </span>
          <small>{hasFiles ? 'Изучаю файлы' : 'Готовлю ответ'}</small>
        </div>
      )}
    </div>
  );
}
