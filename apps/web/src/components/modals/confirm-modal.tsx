'use client';

/**
 * Generic confirmation dialog driven entirely by props from the opener
 * (logout, delete account, remove friend, leave call…). The caller passes the
 * copy + an `onConfirm` handler; the handler may be async, in which case the
 * confirm button shows a spinner until it settles, then the modal closes.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('chrome');
  const tc = useTranslations('common');
  const {
    title,
    body,
    confirmLabel,
    cancelLabel,
    danger = false,
    onConfirm,
    onCancel,
  } = useModalProps<'confirm'>();
  const [busy, setBusy] = useState(false);

  // Caller-provided copy wins; otherwise fall back to the localized defaults.
  const confirmText = confirmLabel ?? t('modals.confirm.confirm');
  const cancelText = cancelLabel ?? tc('cancel');

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
          {cancelText}
        </Button>
        <Button
          type="button"
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          onClick={handleConfirm}
        >
          {confirmText}
        </Button>
      </DialogFooter>
    </>
  );
}
