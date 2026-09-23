import { useId, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { ArrowUpRight, Check, ShoppingCart } from 'lucide-react';
import type { Product } from '../api/types';
import { availableWholeUnits, decimal, hasPositiveStock, money } from '../lib/format';
import { ProductArt } from './ProductArt';
import { QuantityControl } from './QuantityControl';

interface ProductCardProps {
  product: Product;
  onPrepare: (product: Product, quantity: number) => void;
  onDetails: (product: Product) => void;
  disabled?: boolean;
  unavailable?: boolean;
}

export function ProductCard({
  product,
  onPrepare,
  onDetails,
  disabled = false,
  unavailable = false,
}: ProductCardProps) {
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const errorId = useId();
  const stock = availableWholeUnits(product.quantity);
  const inStock = hasPositiveStock(product.quantity);
  const canAdd = !unavailable && stock > 0 && product.price !== null;
  const numericQuantity = Number(quantity);

  function updateQuantity(value: string) {
    setQuantity(value);
    setError('');
  }

  function stepQuantity(step: number) {
    const current = Number.isInteger(numericQuantity) && numericQuantity > 0 ? numericQuantity : 0;
    updateQuantity(String(Math.min(stock, Math.max(1, current + step))));
  }

  function prepareCart() {
    if (!canAdd || disabled) return;
    if (
      !/^\d+$/.test(quantity.trim()) ||
      !Number.isSafeInteger(numericQuantity) ||
      numericQuantity < 1
    ) {
      setError('Введите целое количество от 1.');
      return;
    }
    if (numericQuantity > stock) {
      setError(`Можно добавить не больше ${stock} целых единиц.`);
      return;
    }
    setError('');
    onPrepare(product, numericQuantity);
  }

  return (
    <Box
      component="article"
      className="ekt-product-card"
      sx={{
        border: '1px solid #e5e9ef',
        borderRadius: '14px',
        bgcolor: '#fff',
        p: '16px',
        color: '#1d2b42',
        minWidth: 0,
        boxShadow: '0 2px 4px rgba(25, 45, 76, .025)',
      }}
    >
      <Stack direction="row" spacing={1.6} sx={{ alignItems: 'flex-start' }}>
        <ProductArt name={product.name} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h3" sx={{ fontSize: 13, lineHeight: 1.55, fontWeight: 650, m: 0 }}>
            {product.name}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: '#8a94a5', mt: 0.55 }}>
            Артикул: {product.article || product.id}
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            sx={{
              mt: 0.8,
              color: inStock && !unavailable ? '#2c936a' : '#8792a3',
              alignItems: 'center',
            }}
          >
            {inStock && !unavailable && <Check size={12} strokeWidth={2.5} aria-hidden="true" />}
            <Typography sx={{ fontSize: 10.5 }}>
              {unavailable
                ? 'Товар больше не найден в каталоге'
                : product.quantity === null
                  ? 'Наличие неизвестно'
                  : inStock
                    ? `В наличии · ${decimal(product.quantity)}`
                    : 'Нет в наличии · 0'}
            </Typography>
          </Stack>
        </Box>
      </Stack>

      {!canAdd && (
        <Typography sx={{ fontSize: 11, lineHeight: 1.5, color: '#7b8799', mt: 1.4 }}>
          {unavailable
            ? 'Попробуйте новый поиск, чтобы получить актуальные варианты.'
            : product.price === null || product.quantity === null
              ? 'Для добавления нужно уточнить цену и наличие.'
              : inStock
                ? 'Доступный остаток меньше одной целой единицы.'
                : 'Товар временно отсутствует на складе.'}
        </Typography>
      )}

      <Stack
        direction="row"
        sx={{ mt: 1.8, gap: 1, justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Typography
          component="p"
          sx={{ m: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.4px' }}
        >
          {money(product.price)}
        </Typography>
        {canAdd && (
          <QuantityControl
            name={product.name}
            quantity={quantity}
            stock={stock}
            disabled={disabled}
            error={error}
            errorId={errorId}
            onChange={updateQuantity}
            onStep={stepQuantity}
            onSubmit={prepareCart}
          />
        )}
      </Stack>

      {error && (
        <Typography id={errorId} role="alert" sx={{ mt: 1, fontSize: 11, color: '#c94242' }}>
          {error}
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.6 }}>
        {canAdd && (
          <Button
            variant="contained"
            disableElevation
            onClick={prepareCart}
            disabled={disabled}
            startIcon={<ShoppingCart size={13} />}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 34,
              px: 1,
              borderRadius: '8px',
              bgcolor: '#1761d8',
              color: '#fff',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: '#124fb8' },
              '& .MuiButton-startIcon': { mr: 0.75 },
            }}
          >
            В корзину
          </Button>
        )}
        <Button
          onClick={() => onDetails(product)}
          disabled={unavailable}
          endIcon={<ArrowUpRight size={13} />}
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 34,
            px: 1,
            color: '#5c6b81',
            fontSize: 11,
            fontWeight: 500,
            borderRadius: '8px',
            textTransform: 'none',
            '& .MuiButton-endIcon': { ml: 0.5 },
            '&:hover': { bgcolor: '#f1f5fa', color: '#1761d8' },
          }}
        >
          Подробнее
        </Button>
      </Stack>
    </Box>
  );
}
