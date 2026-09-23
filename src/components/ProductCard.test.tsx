import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { product } from '../test/uiFixtures';
import { ProductCard } from './ProductCard';

afterEach(cleanup);

describe('catalog price and availability', () => {
  it('shows exact fractional stock, but proposes only whole quantities', async () => {
    const onPrepare = vi.fn();
    render(<ProductCard product={product} onPrepare={onPrepare} onDetails={vi.fn()} />);
    expect(screen.getByText('В наличии · 12,5')).toBeInTheDocument();
    expect(screen.getByText('850,00')).toBeInTheDocument();
    const user = userEvent.setup();
    const quantity = screen.getByRole('textbox', { name: `Количество: ${product.name}` });
    await user.clear(quantity);
    await user.type(quantity, '13');
    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    expect(onPrepare).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('не больше 12 целых единиц');
    await user.clear(quantity);
    await user.type(quantity, '12');
    await user.click(screen.getByRole('button', { name: 'В корзину' }));
    expect(onPrepare).toHaveBeenCalledWith(product, 12);
  });

  it('keeps unknown price and stock distinct from known zero', () => {
    const props = { onPrepare: vi.fn(), onDetails: vi.fn() };
    const { rerender } = render(
      <ProductCard {...props} product={{ ...product, price: null, quantity: null }} />,
    );
    expect(screen.getByText('Наличие неизвестно')).toBeInTheDocument();
    expect(screen.getByText('Цена не указана')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
    rerender(<ProductCard {...props} product={{ ...product, price: '0', quantity: '0' }} />);
    expect(screen.getByText('Нет в наличии · 0')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
  });

  it('does not offer adding a fraction or a product whose price is unknown', () => {
    const props = { onPrepare: vi.fn(), onDetails: vi.fn() };
    const { rerender } = render(
      <ProductCard {...props} product={{ ...product, quantity: '0.5' }} />,
    );
    expect(screen.getByText('В наличии · 0,5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
    rerender(<ProductCard {...props} product={{ ...product, price: null }} />);
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
  });

  it('disables actions on a product removed from the catalog', () => {
    render(<ProductCard product={product} unavailable onPrepare={vi.fn()} onDetails={vi.fn()} />);
    expect(screen.getByText('Товар больше не найден в каталоге')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'В корзину' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подробнее' })).toBeDisabled();
  });
});
