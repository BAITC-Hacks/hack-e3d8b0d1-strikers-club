import { Box, IconButton, InputBase } from '@mui/material';
import { Minus, Plus } from 'lucide-react';

interface QuantityControlProps {
  name: string;
  quantity: string;
  stock: number;
  disabled: boolean;
  error: string;
  errorId: string;
  onChange: (value: string) => void;
  onStep: (step: number) => void;
  onSubmit: () => void;
}

export function QuantityControl({
  name,
  quantity,
  stock,
  disabled,
  error,
  errorId,
  onChange,
  onStep,
  onSubmit,
}: QuantityControlProps) {
  const numericQuantity = Number(quantity);

  return (
    <Box
      className="ekt-quantity-control"
      sx={{
        display: 'flex',
        alignItems: 'center',
        border: '1px solid #e6eaf0',
        borderRadius: '8px',
        height: 30,
      }}
    >
      <IconButton
        aria-label={`Уменьшить количество: ${name}`}
        size="small"
        disabled={disabled || numericQuantity <= 1}
        onClick={() => onStep(-1)}
        sx={{ width: 27, height: 28, borderRadius: '7px', color: '#627089' }}
      >
        <Minus size={12} />
      </IconButton>
      <InputBase
        value={quantity}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit();
        }}
        inputProps={{
          inputMode: 'numeric',
          'aria-label': `Количество: ${name}`,
          'aria-invalid': Boolean(error),
          'aria-describedby': error ? errorId : undefined,
        }}
        sx={{
          width: 31,
          fontSize: 11,
          color: '#283a54',
          '& input': { p: 0, textAlign: 'center' },
        }}
      />
      <IconButton
        aria-label={`Увеличить количество: ${name}`}
        size="small"
        disabled={disabled || numericQuantity >= stock}
        onClick={() => onStep(1)}
        sx={{ width: 27, height: 28, borderRadius: '7px', color: '#627089' }}
      >
        <Plus size={12} />
      </IconButton>
    </Box>
  );
}
