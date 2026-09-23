import { useEffect, useId, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { ShoppingBag } from 'lucide-react';
import type { CartProposal } from '../../api/types';
import { decimal, money } from '../../lib/format';

interface ConfirmDialogProps {
  proposal: CartProposal | null;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  proposal,
  pending,
  error,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = proposal ? Date.parse(proposal.expires_at) : 0;
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now;
  useEffect(() => {
    if (!proposal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [proposal]);
  return (
    <Dialog
      open={Boolean(proposal)}
      onClose={() => {
        if (!pending) onClose();
      }}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId}>Добавить в корзину?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>
            {error}
          </Alert>
        )}
        <p className="ekt-dialog-copy">{proposal?.product_name}</p>
        <div className="ekt-confirm-line">
          <span>Количество</span>
          <strong>{proposal?.quantity}</strong>
        </div>
        <div className="ekt-confirm-line">
          <span>Цена за единицу</span>
          <strong>{money(proposal?.price_at_proposal ?? null)}</strong>
        </div>
        <div className="ekt-confirm-line">
          <span>Доступно</span>
          <strong>{decimal(proposal?.available_quantity ?? null)}</strong>
        </div>
        <Alert severity="info" sx={{ mt: 2, fontSize: 12 }}>
          Демонстрационная корзина. Заказ и резерв на ekt.kz не создаются. Перед добавлением
          повторно проверим цену и наличие.
        </Alert>
        {expired && proposal && (
          <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }}>
            Срок предложения истёк. Закройте окно и запросите добавление ещё раз.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button disabled={pending} onClick={onClose}>
          Отмена
        </Button>
        <Button
          variant="contained"
          disabled={pending || expired}
          onClick={() => {
            if (!pending && Date.now() < expiresAt) onConfirm();
          }}
          startIcon={
            pending ? <CircularProgress size={15} color="inherit" /> : <ShoppingBag size={16} />
          }
        >
          Да, добавить
        </Button>
      </DialogActions>
    </Dialog>
  );
}
