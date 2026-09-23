import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cart, proposal } from '../../test/uiFixtures';
import { CartDialog } from './CartDialog';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('backend cart dialogs', () => {
  it('always labels the cart as demo and never turns its API URL into a checkout link', () => {
    render(
      <CartDialog
        open
        onClose={vi.fn()}
        cart={{ ...cart, total_amount: '12345.6789' }}
        loading={false}
        failed={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('ДЕМО')).toBeInTheDocument();
    expect(screen.getByText('12 345,6789')).toBeInTheDocument();
    expect(screen.getByText(/Заказ и резерв на ekt.kz не создаются/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('disables confirmation as the proposal expires while the dialog is open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const confirm = vi.fn();
    render(
      <ConfirmDialog
        proposal={{ ...proposal, expires_at: '2030-01-01T00:00:02Z' }}
        pending={false}
        onClose={vi.fn()}
        onConfirm={confirm}
      />,
    );
    const button = screen.getByRole('button', { name: 'Да, добавить' });
    expect(button).toBeEnabled();
    act(() => vi.advanceTimersByTime(2100));
    expect(button).toBeDisabled();
    expect(screen.getByText(/Срок предложения истёк/)).toBeInTheDocument();
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows changed proposal terms and waits for a new confirmation click', () => {
    const confirm = vi.fn();
    const props = { pending: false, onClose: vi.fn(), onConfirm: confirm };
    const { rerender } = render(<ConfirmDialog {...props} proposal={proposal} />);
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    rerender(
      <ConfirmDialog
        {...props}
        proposal={{
          ...proposal,
          operation_id: 'updated-operation',
          quantity: 1,
          price_at_proposal: '950.25',
        }}
      />,
    );
    expect(screen.getByText('950,25')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
