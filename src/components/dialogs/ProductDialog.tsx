import { useEffect, useId } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, PackageSearch, X } from 'lucide-react';
import type { AssistantApi } from '../../api/types';
import { ApiError } from '../../api/errors';
import { queryKeys } from '../../api/queryKeys';
import { decimal, money, safeUrl } from '../../lib/format';

interface ProductDialogProps {
  api: Pick<AssistantApi, 'product'>;
  productId: string | null;
  onClose: () => void;
  onUnavailable?: (id: string) => void;
}

export function ProductDialog({ api, productId, onClose, onUnavailable }: ProductDialogProps) {
  const titleId = useId();
  const details = useQuery({
    queryKey: queryKeys.product(productId),
    queryFn: () => {
      if (!productId) throw new Error('Не выбран товар.');
      return api.product(productId);
    },
    enabled: Boolean(productId),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (
      productId &&
      details.error instanceof ApiError &&
      details.error.code === 'product_not_found'
    ) {
      onUnavailable?.(productId);
    }
  }, [details.error, onUnavailable, productId]);

  return (
    <Dialog
      open={Boolean(productId)}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
    >
      <DialogTitle
        id={titleId}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        О товаре
        <IconButton aria-label="Закрыть характеристики" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {details.isPending || details.isFetching ? (
          <CircularProgress size={24} />
        ) : details.isError ? (
          <Alert
            severity="error"
            action={<Button onClick={() => void details.refetch()}>Повторить</Button>}
          >
            {details.error instanceof Error
              ? details.error.message
              : 'Не удалось получить информацию. Попробуйте новый поиск.'}
          </Alert>
        ) : (
          details.data && (
            <div className="ekt-product-details">
              <div className="ekt-detail-product-icon">
                <PackageSearch size={30} />
              </div>
              <h3>{details.data.name}</h3>
              <p>Артикул: {details.data.article ?? details.data.id}</p>
              {details.data.brand && <p>Бренд: {details.data.brand}</p>}
              {details.data.category && <p>Категория: {details.data.category}</p>}
              {details.data.description && <p>{details.data.description}</p>}
              <div className="ekt-detail-price">{money(details.data.price)}</div>
              <h4>Характеристики</h4>
              {Object.keys(details.data.attributes ?? {}).length ? (
                <dl>
                  {Object.entries(details.data.attributes ?? {}).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>Характеристики не предоставлены.</p>
              )}
              <h4>Наличие</h4>
              {details.data.stores?.length ? (
                <dl>
                  {details.data.stores.map((store) => (
                    <div key={store.name}>
                      <dt>{store.name}</dt>
                      <dd>{decimal(store.quantity, 'Наличие неизвестно')}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{decimal(details.data.quantity, 'Наличие неизвестно')}</p>
              )}
              <h4>Сертификаты</h4>
              {details.data.certificates?.length ? (
                details.data.certificates.map(
                  (certificate) =>
                    safeUrl(certificate.url) && (
                      <Button
                        key={certificate.url}
                        component="a"
                        href={safeUrl(certificate.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<FileText size={16} />}
                      >
                        {certificate.name || 'Открыть сертификат'}
                      </Button>
                    ),
                )
              ) : (
                <p>В каталоге нет прикреплённых сертификатов.</p>
              )}
              {safeUrl(details.data.product_url) && (
                <Button
                  component="a"
                  href={safeUrl(details.data.product_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<ArrowUpRight size={16} />}
                >
                  Открыть на ekt.kz
                </Button>
              )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
