import { useRef, useState, type ChangeEvent, type DragEvent, type Ref } from 'react';
import { Alert, CircularProgress, IconButton, Tooltip } from '@mui/material';
import { ArrowDown, ArrowUp, FileText, Paperclip, Plus, ShieldCheck, X } from 'lucide-react';
import { attachmentPolicy } from '../../lib/attachments';

interface Props {
  draft: string;
  files: readonly File[];
  fileError: string;
  pending: boolean;
  inputRef: Ref<HTMLTextAreaElement>;
  busy: boolean;
  uploadsDisabled: boolean;
  showSuggestions: boolean;
  actionError: string;
  onDraftChange: (text: string) => void;
  onAttach: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onClearFileError: () => void;
  onClearActionError: () => void;
  onSend: (text?: string) => void;
}
export function Composer({
  draft,
  files,
  fileError,
  pending,
  inputRef,
  busy,
  uploadsDisabled,
  showSuggestions,
  actionError,
  onDraftChange,
  onAttach,
  onRemoveFile,
  onClearFileError,
  onClearActionError,
  onSend,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy && !uploadsDisabled) onAttach(Array.from(event.dataTransfer.files));
  }
  return (
    <div
      className={`ekt-composer-area ${dragging ? 'ekt-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="ekt-drop-label">
          <ArrowDown size={24} />
          Перетащите файлы сюда
        </div>
      )}
      {actionError && (
        <Alert severity="error" onClose={onClearActionError} sx={{ mb: 1, fontSize: 12 }}>
          {actionError}
        </Alert>
      )}
      {fileError && (
        <Alert severity="warning" onClose={onClearFileError} sx={{ mb: 1, fontSize: 12 }}>
          {fileError}
        </Alert>
      )}
      {showSuggestions && (
        <div className="ekt-quick-prompts">
          <span>Например:</span>
          {['Кабель ВВГнг 3×2.5', 'Автомат C16', 'Доставка и оплата'].map((text) => (
            <button key={text} disabled={busy} onClick={() => onSend(text)}>
              {text}
              <Plus size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="ekt-composer">
        {files.length > 0 && (
          <div className="ekt-file-list">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`}>
                <FileText size={15} />
                <span>{file.name}</span>
                <IconButton
                  aria-label={`Удалить файл ${file.name}`}
                  size="small"
                  disabled={busy}
                  onClick={() => onRemoveFile(index)}
                >
                  <X size={13} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          rows={2}
          maxLength={8000}
          aria-label="Ваш вопрос"
          placeholder="Какой товар вы ищете?"
          disabled={pending}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <div className="ekt-composer-bottom">
          <div>
            <Tooltip title="Прикрепить фото или документ">
              <IconButton
                aria-label="Прикрепить файл"
                disabled={busy || uploadsDisabled || files.length >= attachmentPolicy.maxFiles}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip size={20} />
              </IconButton>
            </Tooltip>
            <span>
              {uploadsDisabled ? (
                'Загрузка временно недоступна · напишите текст'
              ) : (
                <>
                  Фото, PDF, Word, Excel <i>· до {attachmentPolicy.maxSizeMb} МБ</i>
                </>
              )}
            </span>
          </div>
          <div>
            <span className="ekt-enter-hint">
              Enter <ArrowUp size={11} />
            </span>
            <IconButton
              className="ekt-send-button"
              aria-label="Отправить сообщение"
              disabled={busy || (!draft.trim() && !files.length)}
              onClick={() => onSend()}
            >
              {pending ? <CircularProgress size={17} color="inherit" /> : <ArrowUp size={20} />}
            </IconButton>
          </div>
        </div>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept={attachmentPolicy.accept}
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onAttach(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>
      <div className="ekt-composer-note">
        <ShieldCheck size={12} />
        Добавляю в корзину только с вашего разрешения<span>на базе AI</span>
      </div>
    </div>
  );
}
