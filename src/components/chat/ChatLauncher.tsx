import type { Ref } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { MessageCircle, X } from 'lucide-react';
interface Props {
  open: boolean;
  showHint: boolean;
  panelId: string;
  buttonRef: Ref<HTMLButtonElement>;
  onToggle: () => void;
}
export function ChatLauncher({ open, showHint, panelId, buttonRef, onToggle }: Props) {
  return (
    <div className={`ekt-assistant ekt-launcher-wrap ${open ? 'ekt-launcher-open' : ''}`}>
      {!open && showHint && <span className="ekt-launcher-hint">Помочь с выбором?</span>}
      <Tooltip title={open ? 'Свернуть чат' : 'Открыть чат'} placement="left">
        <IconButton
          ref={buttonRef}
          className="ekt-launcher"
          aria-label={open ? 'Закрыть помощника' : 'Открыть чат'}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={onToggle}
        >
          {open ? <X size={26} /> : <MessageCircle size={28} strokeWidth={1.8} />}
          {!open && <span className="ekt-launcher-dot" />}
        </IconButton>
      </Tooltip>
    </div>
  );
}
