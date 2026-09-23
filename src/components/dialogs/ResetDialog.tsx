import { useId } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';

interface ResetDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ResetDialog({ open, onClose, onConfirm }: ResetDialogProps) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={titleId}>
      <DialogTitle id={titleId}>Начать новый диалог?</DialogTitle>
      <DialogContent>
        <p className="ekt-dialog-copy">
          Откроется новая сессия с пустой историей и демо-корзиной. Вернуться к текущему диалогу из
          этого окна будет нельзя.
        </p>
      </DialogContent>
      <DialogActions sx={{ p: 2.5, pt: 0 }}>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="contained" onClick={onConfirm}>
          Начать заново
        </Button>
      </DialogActions>
    </Dialog>
  );
}
