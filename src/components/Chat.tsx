import { useCallback, useEffect } from 'react';
import type { AssistantApi } from '../api/types';
import { useAppDispatch, useAppSelector } from '../state/hooks';
import { markProductUnavailable } from '../state/store';
import { useMessaging } from '../hooks/useMessaging';
import { useCartActions } from '../hooks/useCartActions';
import { useSession } from '../hooks/useSession';
import { useChatWindow } from '../hooks/useChatWindow';
import { ChatHeader } from './chat/ChatHeader';
import { ChatLauncher } from './chat/ChatLauncher';
import { Composer } from './chat/Composer';
import { MessageList } from './chat/MessageList';
import { SessionNotice } from './chat/SessionNotice';
import { Welcome } from './chat/Welcome';
import { CartDialog } from './dialogs/CartDialog';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { ProductDialog } from './dialogs/ProductDialog';
import { ResetDialog } from './dialogs/ResetDialog';

export function Chat({ api, initiallyOpen }: { api: AssistantApi; initiallyOpen: boolean }) {
  const { messages, unavailableProducts } = useAppSelector((state) => state.chat);
  const dispatch = useAppDispatch();
  const onUnavailable = useCallback(
    (id: string) => {
      dispatch(markProductUnavailable(id));
    },
    [dispatch],
  );
  const session = useSession(api);
  const { ensure } = session;
  const composer = useMessaging(api, session);
  const cartActions = useCartActions(api, session);
  const { cart, proposal } = cartActions;
  const busy = session.pending || composer.pending || cartActions.pending || !session.ready;
  const panel = useChatWindow({
    initiallyOpen,
    messageCount: messages.length,
    pending: session.pending,
    confirmationOpen: Boolean(proposal),
  });
  useEffect(() => {
    if (panel.open) ensure();
  }, [panel.open, ensure]);

  function send(text = composer.draft) {
    if (busy || (!text.trim() && !composer.files.length)) return;
    cartActions.clearError();
    composer.send(text);
  }
  function openCart() {
    panel.openCart();
    cartActions.refresh();
  }
  function resetConversation() {
    if (busy) return;
    composer.reset();
    cartActions.reset();
    void session.start(true);
    panel.closeDialog();
  }
  const launcher = (
    <ChatLauncher
      open={panel.open}
      showHint={!messages.length}
      panelId={panel.panelId}
      buttonRef={panel.launcherRef}
      onToggle={panel.toggle}
    />
  );
  if (!panel.open) return launcher;
  return (
    <>
      {launcher}
      <section
        id={panel.panelId}
        className={`ekt-assistant ekt-window ${panel.expanded ? 'ekt-expanded' : ''}`}
        aria-label="ИИ-ассистент Электрокомплект"
      >
        <ChatHeader
          mode={api.mode}
          count={cartActions.count}
          expanded={panel.expanded}
          resetDisabled={busy || !messages.length}
          cartDisabled={busy}
          connected={session.ready}
          connecting={session.pending && !session.ready}
          onCart={openCart}
          onReset={panel.openReset}
          onExpand={panel.toggleExpanded}
          onClose={panel.close}
        />
        <SessionNotice
          error={session.error}
          notice={session.notice}
          pending={session.pending}
          onRetry={() => void session.start()}
          onDismiss={session.clearNotice}
        />
        <div className="ekt-conversation" ref={panel.scroll}>
          {!messages.length ? (
            <Welcome send={send} disabled={busy} />
          ) : (
            <MessageList
              messages={messages}
              unavailableProducts={unavailableProducts}
              disabled={busy || Boolean(proposal)}
              pending={composer.pending}
              hasFiles={Boolean(composer.files.length)}
              onCart={openCart}
              onPrepare={cartActions.prepare}
              onDetails={(product) => panel.openProduct(product.id)}
            />
          )}
        </div>
        <Composer
          draft={composer.draft}
          files={composer.files}
          fileError={composer.fileError}
          pending={composer.pending}
          busy={busy}
          uploadsDisabled={composer.uploadsDisabled}
          showSuggestions={!messages.length}
          actionError={cartActions.error}
          inputRef={panel.textInput}
          onDraftChange={composer.setDraft}
          onAttach={composer.attach}
          onRemoveFile={composer.removeFile}
          onClearFileError={composer.clearFileError}
          onClearActionError={cartActions.clearError}
          onSend={send}
        />
        <ConfirmDialog
          proposal={proposal}
          pending={session.pending}
          error={cartActions.error}
          onClose={cartActions.cancel}
          onConfirm={cartActions.confirm}
        />
        <CartDialog
          open={panel.dialog.type === 'cart'}
          onClose={panel.closeDialog}
          cart={cart.data}
          loading={cart.isFetching}
          failed={cart.isError}
          onRetry={cartActions.refresh}
        />
        <ProductDialog
          api={api}
          onUnavailable={onUnavailable}
          productId={panel.dialog.type === 'product' ? panel.dialog.productId : null}
          onClose={panel.closeDialog}
        />
        <ResetDialog
          open={panel.dialog.type === 'reset'}
          onClose={panel.closeDialog}
          onConfirm={resetConversation}
        />
      </section>
    </>
  );
}
