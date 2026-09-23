import { Badge, IconButton, Tooltip } from '@mui/material';
import {
  Maximize2,
  Minimize2,
  Minus,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Zap,
} from 'lucide-react';
interface Props {
  count: number;
  mode: 'demo' | 'live';
  expanded: boolean;
  resetDisabled: boolean;
  cartDisabled: boolean;
  connected: boolean;
  connecting: boolean;
  onCart: () => void;
  onReset: () => void;
  onExpand: () => void;
  onClose: () => void;
}
export function ChatHeader({
  count,
  mode,
  expanded,
  resetDisabled,
  cartDisabled,
  connected,
  connecting,
  onCart,
  onReset,
  onExpand,
  onClose,
}: Props) {
  return (
    <>
      <header className="ekt-header">
        <div className="ekt-avatar">
          <Zap size={25} strokeWidth={1.8} />
        </div>
        <div className="ekt-heading">
          <div>
            Помощник ekt.kz <span className="ekt-ai-badge">AI</span>
          </div>
          <span>
            <i style={{ background: connected ? undefined : '#a4adba' }} />
            {connecting
              ? 'Подключаемся…'
              : connected
                ? 'Помогу с выбором электротехники'
                : 'Ожидаем подключения'}
          </span>
        </div>
        <div className="ekt-header-actions">
          <Tooltip title="Корзина">
            <IconButton
              aria-label={`Корзина, ${count} товаров`}
              disabled={cartDisabled}
              onClick={onCart}
            >
              <Badge badgeContent={count} color="primary">
                <ShoppingBag size={20} />
              </Badge>
            </IconButton>
          </Tooltip>
          <span className="ekt-header-separator" />
          <Tooltip title="Новый диалог">
            <IconButton aria-label="Новый диалог" disabled={resetDisabled} onClick={onReset}>
              <RotateCcw size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={expanded ? 'Обычный размер' : 'Развернуть'}>
            <IconButton
              className="ekt-expand-button"
              aria-label={expanded ? 'Обычный размер' : 'Развернуть'}
              onClick={onExpand}
            >
              {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Свернуть чат">
            <IconButton aria-label="Свернуть чат" onClick={onClose}>
              <Minus size={20} />
            </IconButton>
          </Tooltip>
        </div>
      </header>
      <div className="ekt-mode-strip">
        <span>
          <ShieldCheck size={13} />
          {mode === 'demo'
            ? 'Демо-режим · цены и остатки тестовые'
            : 'Каталог ekt.kz · корзина демонстрационная'}
        </span>
        <span className="ekt-mode-right">
          {mode === 'demo' ? 'Знакомство с помощником' : 'Электрокомплект'}
        </span>
      </div>
    </>
  );
}
