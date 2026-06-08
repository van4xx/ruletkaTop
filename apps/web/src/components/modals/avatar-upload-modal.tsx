'use client';

/**
 * Set or reset the profile avatar.
 *
 * The avatar is now an IMAGE FILE stored server-side: this modal picks a local
 * image, shows a live preview, and uploads it to `POST /profiles/me/avatar`
 * (multipart, field `file`). The server validates the bytes (magic-number +
 * size cap), re-encodes/resizes it, deletes the previous file, and returns the
 * updated public profile — which we write straight into the economy "me" cache
 * (and mirror onto the profile detail caches) so the new avatar shows instantly.
 *
 * The old "by URL" input was removed (users found it confusing): file upload is
 * the only way to set an avatar. When an avatar already exists, a "Remove"
 * action resets it to the default via `DELETE /profiles/me/avatar`.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2, UploadCloud } from 'lucide-react';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  type PublicProfile,
} from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@ruletka/ui';
import { ApiClientError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { meKey } from '@/features/economy/use-me';
import { profileKeys } from '@/features/profile/use-profile';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { FieldError } from './shared';

const ALLOWED_MIME = new Set<string>(AVATAR_ALLOWED_MIME_TYPES);

export function AvatarUploadModal() {
  const { close } = useModal();
  const t = useTranslations('chrome');
  const { currentUrl } = useModalProps<'avatar-upload'>();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // The picked file (not yet uploaded) + its object-URL preview.
  const [file, setFile] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Revoke the object URL we created whenever it changes / on unmount.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  /** Fan the fresh profile out to every cache that renders the avatar. */
  function syncCaches(updated: PublicProfile) {
    // `meKey` IS `['economy','me']` — the header/dashboard avatar source.
    qc.setQueryData(meKey, updated);
    // The profile-page hero reads its own detail key; mirror the fresh avatar
    // there too so an open profile updates without a refetch.
    qc.setQueryData(profileKeys.detail(updated.id), updated);
    void qc.invalidateQueries({ queryKey: meKey });
    void qc.invalidateQueries({ queryKey: ['auth', 'me'] });
  }

  const upload = useMutation({
    mutationFn: (f: File) => api.profile.uploadAvatar(f),
    onSuccess: (updated: PublicProfile) => {
      syncCaches(updated);
      toast.success(t('modals.avatarUpload.savedTitle'));
      close();
    },
    onError: (err: unknown) => {
      // Surface a server validation message (e.g. unsupported/invalid image)
      // when present; otherwise a generic failure.
      const msg =
        err instanceof ApiClientError && typeof err.body?.message === 'string'
          ? err.body.message
          : t('modals.avatarUpload.errUploadFailed');
      toast.error(msg);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.profile.removeAvatar(),
    onSuccess: (updated: PublicProfile) => {
      syncCaches(updated);
      toast.success(t('modals.avatarUpload.removedTitle'));
      close();
    },
    onError: () => toast.error(t('modals.avatarUpload.errGeneric')),
  });

  function pickFile(picked: File | undefined) {
    if (!picked) return;
    // Client-side first-line checks mirror the server's contract; the server
    // still re-validates the bytes authoritatively.
    if (!ALLOWED_MIME.has(picked.type) && !picked.type.startsWith('image/')) {
      setError(t('modals.avatarUpload.errNotImage'));
      return;
    }
    if (picked.size > AVATAR_MAX_BYTES) {
      setError(t('modals.avatarUpload.errTooLarge'));
      return;
    }
    setError(null);
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(picked));
    setFile(picked);
  }

  const busy = upload.isPending || remove.isPending;
  const preview = localPreview ?? currentUrl ?? undefined;
  const hasCurrent = Boolean(currentUrl);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('modals.avatarUpload.title')}</DialogTitle>
        <DialogDescription>{t('modals.avatarUpload.description')}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {/* Live preview */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Avatar
            size="xl"
            src={preview}
            alt={t('modals.avatarUpload.previewAlt')}
            ring="aurora"
          />
          <span className="text-xs text-muted-foreground">{t('modals.avatarUpload.preview')}</span>
        </div>

        {/* Picker + actions */}
        <div className="w-full space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          {/* Clickable dropzone-style trigger (keyboard + pointer). */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={cn(
              'group flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-4 py-6 text-center transition-colors',
              'hover:border-[var(--color-neon-violet)]/60 hover:bg-card/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-neon-violet)]/15 text-foreground ring-1 ring-[var(--color-neon-violet)]/40 transition-transform group-hover:scale-105">
              <ImagePlus className="h-5 w-5" />
            </span>
            <span className="font-display text-sm font-semibold">
              {file ? t('modals.avatarUpload.pickAnother') : t('modals.avatarUpload.pickPhoto')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('modals.avatarUpload.uploadNotice')}
            </span>
          </button>

          <FieldError>{error}</FieldError>
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        {/* Reset-to-default (only when an avatar exists). */}
        {hasCurrent ? (
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<Trash2 className="h-4 w-4" />}
            onClick={() => remove.mutate()}
            loading={remove.isPending}
            disabled={busy}
            className="text-destructive hover:text-destructive"
          >
            {t('modals.avatarUpload.removeAvatar')}
          </Button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            {t('modals.avatarUpload.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            leadingIcon={<UploadCloud className="h-4 w-4" />}
            disabled={!file || busy}
            loading={upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            {t('modals.avatarUpload.uploadCta')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
