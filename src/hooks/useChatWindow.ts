import { useCallback, useEffect, useId, useRef, useState } from 'react';

type DialogState = { type: 'none' | 'cart' | 'reset' } | { type: 'product'; productId: string };

interface Options {
  initiallyOpen: boolean;
  messageCount: number;
  pending: boolean;
  confirmationOpen: boolean;
}

export function useChatWindow({ initiallyOpen, messageCount, pending, confirmationOpen }: Options) {
  const [open, setOpen] = useState(initiallyOpen);
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const launcherRef = useRef<HTMLButtonElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const panelId = useId();
  const hasDialog = dialog.type !== 'none' || confirmationOpen;

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);
  const closeDialog = useCallback(() => {
    setDialog({ type: 'none' });
    if (window.location.hash === '#cart') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    scroll.current?.scrollTo({
      top: messageCount ? scroll.current.scrollHeight : 0,
      behavior: messageCount ? 'smooth' : 'instant',
    });
  }, [messageCount, pending, open]);

  useEffect(() => {
    if (open && !pending && !hasDialog) textInput.current?.focus({ preventScroll: true });
    else if (!open && wasOpen.current) launcherRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open, pending, hasDialog]);

  useEffect(() => {
    if (!open || hasDialog) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, hasDialog, close]);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#cart') {
        setOpen(true);
        setDialog({ type: 'cart' });
      }
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return {
    open,
    expanded,
    dialog,
    panelId,
    launcherRef,
    textInput,
    scroll,
    close,
    closeDialog,
    toggle: () => {
      if (open) close();
      else setOpen(true);
    },
    toggleExpanded: () => setExpanded((value) => !value),
    openCart: () => setDialog({ type: 'cart' }),
    openReset: () => setDialog({ type: 'reset' }),
    openProduct: (productId: string) => setDialog({ type: 'product', productId }),
  };
}
