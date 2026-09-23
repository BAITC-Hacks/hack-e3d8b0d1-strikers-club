import { Alert, Button } from '@mui/material';

interface Props {
  error: string;
  notice: string;
  pending: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}
export function SessionNotice({ error, notice, pending, onRetry, onDismiss }: Props) {
  if (!error && !notice) return null;
  return (
    <Alert
      severity={error ? 'error' : 'info'}
      sx={{ mx: 2, mt: 1, fontSize: 12, overflowWrap: 'anywhere' }}
      onClose={error ? undefined : onDismiss}
      action={
        error && (
          <Button disabled={pending} size="small" onClick={onRetry}>
            Повторить
          </Button>
        )
      }
    >
      {error || notice}
    </Alert>
  );
}
