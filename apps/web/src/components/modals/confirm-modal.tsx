'use client';

/**
 * Generic confirmation dialog driven entirely by props from the opener
 * (logout, delete account, remove friend, leave call…). The caller passes the
 * copy + an `onConfirm` handler; the handler may be async, in which case the
 * confirm button shows a spinner until it settles, then the modal closes.
 */
import { useState } from 'react';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ruletka/ui';
import { useModal, useModalProps } from '@/lib/stores/modal-store';

export function ConfirmModal() {
  const { close } = useModal();
  const {
    title,
    body,
    confirmLabel = 'Подтвердить',
    cancelLabel = 'Отмена',
    danger = false,
    onConfirm,
    onCancel,
  } = useModalProps<'confirm'>();
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    try {
      setBusy(true);
      await onConfirm();
      close();
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    onCancel?.();
    close();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {typeof body === 'string' ? (
          <DialogDescription>{body}</DialogDescription>
        ) : body ? (
          // Non-string bodies render in a div (DialogDescription is a <p>, so we
          // avoid invalid block-in-<p> nesting). Still themed like a description.
          <div className="text-sm text-muted-foreground">{body}</div>
        ) : null}
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={handleCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
