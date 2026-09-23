import { useId } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from '@mui/material';
import { ArrowRight, ShoppingBag, X } from 'lucide-react';
import type { Cart } from '../../api/types';
import { money } from '../../lib/format';

interface CartDialogProps {
  open: boolean;
  onClose: () => void;
  cart?: Cart;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

export function CartDialog({ open, onClose, cart, loading, failed, onRetry }: CartDialogProps) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle
        id={titleId}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        Корзина <span className="ekt-demo-pill">ДЕМО</span>
        <IconButton aria-label="Закрыть корзину" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
          Демонстрационная корзина. Заказ и резерв на ekt.kz не создаются.
        </Alert>
        {loading ? (
          <CircularProgress size={24} />
        ) : failed ? (
          <Alert severity="error" action={<Button onClick={onRetry}>Повторить</Button>}>
            Не удалось загрузить корзину.
          </Alert>
        ) : cart?.items.length ? (
          <>
            <div className="ekt-cart-items">
              {cart.items.map((item) => (
                <div key={item.product_id}>
                  <div>
                    <strong>{item.product_name}</strong>
                    <span>
                      {item.quantity} × {money(item.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="ekt-cart-total">
              <span>Итого</span>
              <strong>{money(cart.total_amount)}</strong>
            </div>
          </>
        ) : (
          <div className="ekt-empty-cart">
            <ShoppingBag size={40} strokeWidth={1.3} />
            <h3>Здесь пока пусто</h3>
            <p>Найдите товар в чате и подтвердите добавление.</p>
            <Button onClick={onClose} endIcon={<ArrowRight size={15} />}>
              Вернуться к помощнику
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
