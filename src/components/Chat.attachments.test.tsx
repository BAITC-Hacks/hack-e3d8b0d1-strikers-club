import '@testing-library/jest-dom/vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatReply } from '../api/types';
import {
  clearChatClients,
  deferred,
  mockApi,
  renderChat,
  reply,
  sessionId,
} from '../test/chatHarness';

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  clearChatClients();
});

describe('backend file turns', () => {
  it('uploads on Send, then sends text as a separate turn without attachment identifiers', async () => {
    const api = mockApi();
    const uploaded = deferred<ChatReply>();
    api.upload.mockReturnValue(uploaded.promise);
    const { container } = await renderChat(api);
    const user = userEvent.setup();
    const file = new File(['specification'], 'specification.pdf', { type: 'application/pdf' });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file);
    await user.type(screen.getByRole('textbox', { name: 'Ваш вопрос' }), 'Найди товары из файла');
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.chat).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    expect(api.upload).toHaveBeenCalledExactlyOnceWith(sessionId, file);
    expect(api.chat).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Корзина, 0 товаров' })).toBeDisabled();
    await act(async () => uploaded.resolve(reply({ message: 'Файл распознан' })));
    await waitFor(() =>
      expect(api.chat).toHaveBeenCalledExactlyOnceWith(sessionId, 'Найди товары из файла'),
    );
    expect(await screen.findByText('Ответ на вопрос')).toBeInTheDocument();
    expect(screen.getByText('Файл распознан')).toBeInTheDocument();
    expect(api.cart).not.toHaveBeenCalled();
  });

  it('supports a file without text and displays the upload response', async () => {
    const api = mockApi();
    const { container } = await renderChat(api);
    const user = userEvent.setup();
    const file = new File(['photo'], 'product.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file);
    await user.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    expect(await screen.findByText('Файл распознан')).toBeInTheDocument();
    expect(api.upload).toHaveBeenCalledExactlyOnceWith(sessionId, file);
    expect(api.chat).not.toHaveBeenCalled();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  it('restores text and the file after an upload failure and waits for a manual retry', async () => {
    const api = mockApi();
    api.upload.mockRejectedValue(new Error('Не удалось загрузить файл.'));
    const { container } = await renderChat(api);
    const user = userEvent.setup();
    const file = new File(['specification'], 'specification.pdf', { type: 'application/pdf' });
    await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file);
    await user.type(screen.getByRole('textbox', { name: 'Ваш вопрос' }), 'Подбери аналог');
    await user.click(screen.getByRole('button', { name: 'Отправить сообщение' }));
    expect(await screen.findByText('Не удалось загрузить файл.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Ваш вопрос' })).toHaveValue('Подбери аналог');
    expect(
      screen.getByRole('button', { name: 'Удалить файл specification.pdf' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled();
    expect(api.upload).toHaveBeenCalledOnce();
    expect(api.chat).not.toHaveBeenCalled();
  });
});
