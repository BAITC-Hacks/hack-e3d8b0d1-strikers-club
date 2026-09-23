import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../../test/uiFixtures';
import { ApiError } from '../../api/errors';
import { ProductDialog } from './ProductDialog';

afterEach(cleanup);

it('fetches fresh details every time the product dialog opens', async () => {
  const api = { product: vi.fn().mockResolvedValue(product) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const draw = (productId: string | null) => (
    <QueryClientProvider client={client}>
      <ProductDialog api={api} productId={productId} onClose={vi.fn()} />
    </QueryClientProvider>
  );
  const { rerender } = render(draw(product.id));
  expect(await screen.findByText('850,00')).toBeInTheDocument();
  expect(api.product).toHaveBeenCalledExactlyOnceWith(product.id);
  rerender(draw(null));
  api.product.mockResolvedValue({ ...product, price: '975.01' });
  rerender(draw(product.id));
  expect(await screen.findByText('975,01')).toBeInTheDocument();
  expect(api.product).toHaveBeenCalledTimes(2);
  client.clear();
});

it('marks a removed product unavailable after a typed backend not-found error', async () => {
  const api = {
    product: vi.fn().mockRejectedValue(new ApiError(404, 'product_not_found', 'missing')),
  };
  const unavailable = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProductDialog
        api={api}
        productId={product.id}
        onClose={vi.fn()}
        onUnavailable={unavailable}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText('Товар больше не найден в каталоге. Попробуйте новый поиск.'),
  ).toBeInTheDocument();
  expect(unavailable).toHaveBeenCalledWith(product.id);
  client.clear();
});
