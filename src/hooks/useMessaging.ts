import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AssistantApi } from '../api/types';
import { ApiError } from '../api/errors';
import { validateAttachments } from '../lib/attachments';
import { errorMessage } from '../lib/errorMessage';
import { useAppDispatch } from '../state/hooks';
import { addMessage } from '../state/store';
import type { SessionController } from './useSession';
import { useResponses } from './useResponses';

interface Submission {
  text: string;
  attached: File[];
}
interface UploadCache {
  sessionId: string;
  uploaded: Set<File>;
  lastSubmission?: Submission;
}
interface SendRequest extends Submission {
  cache: UploadCache;
}
const emptyComposer = { draft: '', files: [] as File[], fileError: '' };

export function useMessaging(api: AssistantApi, session: SessionController) {
  const dispatch = useAppDispatch();
  const apply = useResponses();
  const [composer, setComposer] = useState(emptyComposer);
  const [uploadsDisabled, setUploadsDisabled] = useState(false);
  const uploadCache = useRef<UploadCache | null>(null);
  const sending = useRef(false);
  const isCurrent = (cache: UploadCache) =>
    uploadCache.current === cache && session.isCurrent(cache.sessionId);

  const mutation = useMutation({
    retry: false,
    mutationFn: ({ text, attached, cache }: SendRequest) =>
      session.run(async (id) => {
        for (const file of attached) {
          if (!isCurrent(cache)) return;
          if (cache.uploaded.has(file)) continue;
          const reply = await api.upload(id, file);
          if (!isCurrent(cache)) return;
          cache.uploaded.add(file);
          apply(id, reply);
        }
        if (text && isCurrent(cache)) apply(id, await api.chat(id, text));
      }),
    onSuccess: (_, { cache }) => {
      if (isCurrent(cache)) uploadCache.current = null;
    },
    onError: (error, { text, attached, cache }) => {
      if (!isCurrent(cache)) return;
      const scannerUnavailable =
        error instanceof ApiError && error.code === 'upload_scanner_unavailable';
      if (scannerUnavailable) setUploadsDisabled(true);
      dispatch(addMessage({ role: 'assistant', text: errorMessage(error), error: true }));
      setComposer({ draft: text, files: scannerUnavailable ? [] : attached, fileError: '' });
    },
    onSettled: () => {
      sending.current = false;
    },
  });

  function reset() {
    uploadCache.current = null;
    setComposer(emptyComposer);
  }
  function send(text = composer.draft) {
    const trimmed = text.trim();
    if (
      (!trimmed && !composer.files.length) ||
      sending.current ||
      session.pending ||
      !session.ready
    )
      return;
    sending.current = true;
    const attached = [...composer.files];
    if (uploadCache.current?.sessionId !== session.sessionId)
      uploadCache.current = { sessionId: session.sessionId, uploaded: new Set() };
    const cache = uploadCache.current;
    const previous = cache.lastSubmission;
    const isRetry =
      previous?.text === trimmed &&
      previous.attached.length === attached.length &&
      attached.every((file, index) => file === previous.attached[index]);
    if (!isRetry)
      dispatch(
        addMessage({ role: 'user', text: trimmed, files: attached.map((file) => file.name) }),
      );
    cache.lastSubmission = { text: trimmed, attached };
    setComposer(emptyComposer);
    mutation.mutate({ text: trimmed, attached, cache });
  }
  function attach(incoming: File[]) {
    if (uploadsDisabled || session.pending) return;
    setComposer((current) => ({ ...current, ...validateAttachments(current.files, incoming) }));
  }

  return {
    ...composer,
    uploadsDisabled,
    send,
    reset,
    attach,
    setDraft: (draft: string) => setComposer((current) => ({ ...current, draft })),
    removeFile: (index: number) =>
      setComposer((current) => ({
        ...current,
        files: current.files.filter((_, i) => i !== index),
      })),
    clearFileError: () => setComposer((current) => ({ ...current, fileError: '' })),
    pending: mutation.isPending,
  };
}
