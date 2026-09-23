import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { product } from '../../test/uiFixtures';
import { MessageList } from './MessageList';
import { StructuredResults } from './StructuredResults';

afterEach(cleanup);
const callbacks = { disabled: false, onPrepare: vi.fn(), onDetails: vi.fn() };

describe('structured backend results', () => {
  it('shows catalog analog differences and unknown parameters next to its card', () => {
    render(
      <StructuredResults
        {...callbacks}
        analogs={[
          {
            kind: 'catalog_analog',
            product_id: product.id,
            product,
            score: 0.87,
            match: ['Сечение'],
            differences: ['Другая оболочка'],
            unknown: ['Пожарный класс'],
            quantity: product.quantity,
            recommendation: 'possible_alternative',
          },
        ]}
      />,
    );
    expect(screen.getByText(/Другая оболочка/)).toBeInTheDocument();
    expect(screen.getByText(/Пожарный класс/)).toBeInTheDocument();
    expect(screen.getByText(/Полная взаимозаменяемость не подтверждена/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'В корзину' })).toBeInTheDocument();
  });

  it('renders external sources without cart actions and labels low-confidence recognition', () => {
    render(
      <StructuredResults
        {...callbacks}
        externalVariants={[
          {
            kind: 'external_variant',
            name: 'Внешний вариант',
            url: 'javascript:alert(1)',
            attributes: [],
            differences: ['Другой производитель'],
            unknown: ['Остаток'],
            recommendation: 'requires_review',
          },
        ]}
        extracted={[
          {
            article: 'A-123',
            barcode: null,
            brand: null,
            model: null,
            category: null,
            attributes: [],
            quantity: null,
            unreadable_fields: ['Модель'],
            confidence: 0.4,
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Товар не идентифицирован/)).toBeInTheDocument();
    expect(screen.getByText(/Не удалось прочитать: Модель/)).toBeInTheDocument();
  });

  it('opens the local cart UI instead of navigating to protected API URLs', () => {
    const onCart = vi.fn();
    render(
      <MessageList
        {...callbacks}
        messages={[{ id: 'm1', role: 'assistant', text: 'Добавлено', cartLink: true }]}
        pending={false}
        hasFiles={false}
        onCart={onCart}
      />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Открыть корзину/ }));
    expect(onCart).toHaveBeenCalledOnce();
  });
});
