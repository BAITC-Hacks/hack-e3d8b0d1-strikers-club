import { Alert, Box, Stack, Typography } from '@mui/material';
import type { IdentifiedProduct } from '../../api/types';

export function RecognizedProducts({ products }: { products: IdentifiedProduct[] }) {
  if (!products.length) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1.5 }}>
      <Typography component="h4" sx={{ fontSize: 12, fontWeight: 650 }}>
        Распознано во вложении
      </Typography>
      {products.map((product, index) => {
        const fields = [
          ['Артикул', product.article],
          ['Штрихкод', product.barcode],
          ['Бренд', product.brand],
          ['Модель', product.model],
          ['Категория', product.category],
          ['Количество', product.quantity],
          ...product.attributes.map(({ name, value }) => [name, value]),
        ].filter(([, value]) => value !== null && value !== '');
        return (
          <Box key={index} sx={{ bgcolor: '#f3f6fa', borderRadius: 2, p: 1.5 }}>
            <Alert severity={product.confidence < 0.65 ? 'warning' : 'info'} sx={{ fontSize: 11 }}>
              {product.confidence < 0.65
                ? 'Низкая уверенность. Товар не идентифицирован — уточните данные или загрузите более чёткое изображение.'
                : 'Данные из файла. Наличие товара в каталоге проверяется отдельно.'}{' '}
              Уверенность: {Math.round(product.confidence * 100)}%.
            </Alert>
            {fields.map(([name, value], fieldIndex) => (
              <Typography key={fieldIndex} sx={{ mt: 0.75, fontSize: 11 }}>
                <strong>{name}: </strong>
                {value}
              </Typography>
            ))}
            {product.unreadable_fields.length > 0 && (
              <Typography sx={{ mt: 1, fontSize: 11, color: '#96651b' }}>
                Не удалось прочитать: {product.unreadable_fields.join(', ')}.
              </Typography>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
