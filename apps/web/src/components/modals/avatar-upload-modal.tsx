'use client';

/**
 * Set a new avatar.
 *
 * The profile contract stores an avatar as a URL (`updateProfileSchema.avatarUrl`
 * is a `string().url()`), and there is no file-upload endpoint yet — so this
 * modal has two modes:
 *   • "По ссылке": paste an image URL → validated → PATCH /profile/me. Fully wired.
 *   • "Загрузить": pick a local image for a live preview. Saving a *local* file
 *     needs an upload endpoint (see the integrator note); until then the local
 *     mode previews only and points the user at the URL mode.
 *
 * Persists via the base `api.profile.update` and refreshes the economy "me"
 * query so the new avatar shows immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Link2, Upload } from 'lucide-react';
import { z } from 'zod';
import type { PublicProfile, UpdateProfileDto } from '@ruletka/shared-types';
import {
  Avatar,
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@ruletka/ui';
import { api } from '@/lib/api';
import { meKey } from '@/features/economy/use-me';
import { useModal, useModalProps } from '@/lib/stores/modal-store';
import { FieldError } from './shared';

const urlSchema = z.string().url();

export function AvatarUploadModal() {
  const { close } = useModal();
  const { currentUrl } = useModalProps<'avatar-upload'>();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState(currentUrl ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  // Revoke any object URL we created when the modal unmounts.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const save = useMutation({
    mutationFn: (dto: UpdateProfileDto) => api.profile.update(dto),
    onSuccess: (updated: PublicProfile) => {
      qc.setQueryData(meKey, updated);
      void qc.invalidateQueries({ queryKey: meKey });
      toast.success('Аватар обновлён');
      close();
    },
    onError: () => toast.error('Не удалось обновить аватар'),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Файл слишком большой', { description: 'Максимум 5 МБ.' });
      return;
    }
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(file));
  }

  function saveUrl() {
    const trimmed = url.trim();
    if (!urlSchema.safeParse(trimmed).success) {
      setUrlError('Введите корректную ссылку на изображение (https://…).');
      return;
    }
    setUrlError(null);
    save.mutate({ avatarUrl: trimmed });
  }

  const preview = mode === 'file' ? localPreview : url.trim() || currentUrl;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Сменить аватар</DialogTitle>
        <DialogDescription>Загрузите новое фото профиля или вставьте ссылку.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* Live preview */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <Avatar size="xl" src={preview || undefined} alt="Предпросмотр аватара" ring="aurora" />
          <span className="text-xs text-muted-foreground">Предпросмотр</span>
        </div>

        <div className="w-full">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'url' | 'file')}>
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1">
                <Link2 className="mr-1.5 h-4 w-4" /> По ссылке
              </TabsTrigger>
              <TabsTrigger value="file" className="flex-1">
                <Upload className="mr-1.5 h-4 w-4" /> Загрузить
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-1.5 pt-3">
              <Label htmlFor="avatar-url">Ссылка на изображение</Label>
              <Input
                id="avatar-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder="https://example.com/avatar.jpg"
                invalid={!!urlError}
                autoComplete="off"
                spellCheck={false}
              />
              <FieldError>{urlError}</FieldError>
            </TabsContent>

            <TabsContent value="file" className="space-y-3 pt-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleFile}
              />
              <Button
                type="button"
                variant="outline"
                block
                leadingIcon={<ImagePlus className="h-4 w-4" />}
                onClick={() => fileRef.current?.click()}
              >
                {localPreview ? 'Выбрать другое фото' : 'Выбрать фото'}
              </Button>
              <p className="rounded-lg border border-border/60 bg-card/40 p-2.5 text-xs text-muted-foreground">
                Загрузка файлов скоро появится. Пока сохраните аватар по ссылке на вкладке «По
                ссылке» — например, из вашего облака или соцсети.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close}>
          Отмена
        </Button>
        {mode === 'url' ? (
          <Button type="button" variant="primary" loading={save.isPending} onClick={saveUrl}>
            Сохранить
          </Button>
        ) : (
          <Button type="button" variant="primary" disabled title="Нужен эндпоинт загрузки файлов">
            Сохранить
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
