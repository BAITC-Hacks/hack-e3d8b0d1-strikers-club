import { Box, Button, Stack, Typography } from '@mui/material';
import { ArrowUpRight } from 'lucide-react';
import type { Analog, ExternalVariant, IdentifiedProduct, Product } from '../../api/types';
import { safeUrl } from '../../lib/format';
import { ProductCard } from '../ProductCard';
import { RecognizedProducts } from './RecognizedProducts';

interface Props {
  analogs?: Analog[];
  externalVariants?: ExternalVariant[];
  extracted?: IdentifiedProduct[];
  disabled: boolean;
  unavailableProducts?: readonly string[];
  onPrepare: (product: Product, quantity: number) => void;
  onDetails: (product: Product) => void;
}

function Notes({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <Typography component="p" sx={{ m: 0, mt: 0.75, fontSize: 11, lineHeight: 1.6 }}>
      <strong>{title}: </strong>
      {values.join('; ')}
    </Typography>
  );
}

export function StructuredResults({
  analogs = [],
  externalVariants = [],
  extracted = [],
  disabled,
  unavailableProducts = [],
  onPrepare,
  onDetails,
}: Props) {
  return (
    <>
      {analogs.length > 0 && (
        <Stack spacing={1.2} sx={{ mt: 1.5 }}>
          <Typography component="h4" sx={{ fontSize: 12, fontWeight: 650 }}>
            Возможные аналоги
          </Typography>
          {analogs.map((analog, index) => (
            <Box key={`${analog.product_id}-${index}`}>
              <ProductCard
                product={analog.product}
                unavailable={unavailableProducts.includes(analog.product.id)}
                disabled={disabled}
                onPrepare={onPrepare}
                onDetails={onDetails}
              />
              <Box sx={{ p: 1.5, bgcolor: '#f3f6fa', borderRadius: 2, mt: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: '#596980' }}>
                  Оценка совпадения: {Math.round(analog.score * 100)}%.{' '}
                  {analog.recommendation === 'requires_review'
                    ? 'Требуется проверка специалистом.'
                    : 'Возможная альтернатива.'}{' '}
                  Полная взаимозаменяемость не подтверждена.
                </Typography>
                <Notes title="Совпадает" values={analog.match} />
                <Notes title="Отличия" values={analog.differences} />
                <Notes title="Неизвестно" values={analog.unknown} />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
      {externalVariants.length > 0 && (
        <Stack spacing={1.2} sx={{ mt: 1.5 }}>
          <Typography component="h4" sx={{ fontSize: 12, fontWeight: 650 }}>
            Внешние источники · требуется проверка
          </Typography>
          {externalVariants.map((variant, index) => (
            <Box
              component="article"
              key={`${variant.url}-${index}`}
              sx={{ border: '1px solid #e5e9ef', bgcolor: '#fff', borderRadius: 2, p: 1.5 }}
            >
              <Typography component="h3" sx={{ fontSize: 13, fontWeight: 650 }}>
                {variant.name}
              </Typography>
              <Notes
                title="Характеристики"
                values={variant.attributes.map(({ name, value }) => `${name}: ${value}`)}
              />
              <Notes title="Отличия" values={variant.differences} />
              <Notes title="Неизвестно" values={variant.unknown} />
              <Typography sx={{ mt: 1, fontSize: 11, color: '#748197' }}>
                Внешний вариант. Добавление в корзину EKT недоступно.
              </Typography>
              {safeUrl(variant.url) && (
                <Button
                  component="a"
                  href={safeUrl(variant.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<ArrowUpRight size={14} />}
                  size="small"
                >
                  Посмотреть источник
                </Button>
              )}
            </Box>
          ))}
        </Stack>
      )}
      <RecognizedProducts products={extracted} />
    </>
  );
}
