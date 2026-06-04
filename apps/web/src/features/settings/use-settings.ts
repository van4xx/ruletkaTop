'use client';

/**
 * Settings data layer — feature-local TanStack Query hooks that wrap the
 * existing base api client (`api.request`) for endpoints not yet modelled in
 * `lib/api`. No shared files are touched.
 *
 * Endpoints used (all live in the backend contract):
 *   GET   /settings                         → Settings
 *   PATCH /settings                         → Settings           (updateSettingsSchema)
 *   GET   /moderation/blocks                → Block[]
 *   DELETE /moderation/blocks/:blockedUserId
 *   PATCH /profile/me                       → PublicProfile      (updateProfileSchema)
 *
 * The change-password and delete-account flows target conventional endpoints
 * (`POST /auth/change-password`, `DELETE /auth/me`); if the backend has not
 * shipped them yet the mutations surface the API error to the UI. See the
 * integrator notes in the agent summary.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Block,
  PublicProfile,
  Settings,
  UpdateProfileDto,
  UpdateSettingsDto,
} from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';
import { CURRENT_USER_KEY } from '@/features/auth/use-auth';

export const SETTINGS_KEY = ['settings'] as const;
export const BLOCKS_KEY = ['moderation', 'blocks'] as const;
export const PROFILE_ME_KEY = ['profile', 'me'] as const;

// ─────────────────────────────── Settings ─────────────────────────────────
export function useSettings(): UseQueryResult<Settings, ApiClientError> {
  return useQuery<Settings, ApiClientError>({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.request<Settings>('/settings'),
    staleTime: 60_000,
  });
}

export function useUpdateSettings(): UseMutationResult<
  Settings,
  ApiClientError,
  UpdateSettingsDto
> {
  const queryClient = useQueryClient();
  return useMutation<Settings, ApiClientError, UpdateSettingsDto>({
    mutationFn: (dto) => api.request<Settings>('/settings', { method: 'PATCH', json: dto }),
    onSuccess: (settings) => {
      queryClient.setQueryData(SETTINGS_KEY, settings);
    },
  });
}

// ──────────────────────────── Profile (account) ───────────────────────────
export function useProfileMe(): UseQueryResult<PublicProfile, ApiClientError> {
  return useQuery<PublicProfile, ApiClientError>({
    queryKey: PROFILE_ME_KEY,
    queryFn: () => api.profile.me(),
    staleTime: 60_000,
  });
}

export function useUpdateProfile(): UseMutationResult<
  PublicProfile,
  ApiClientError,
  UpdateProfileDto
> {
  const queryClient = useQueryClient();
  return useMutation<PublicProfile, ApiClientError, UpdateProfileDto>({
    mutationFn: (dto) => api.profile.update(dto),
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_ME_KEY, profile);
      // Nickname/avatar may have changed → refresh the auth user too.
      queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
  });
}

// ───────────────────────────── Change password ────────────────────────────
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export function useChangePassword(): UseMutationResult<
  void,
  ApiClientError,
  ChangePasswordPayload
> {
  return useMutation<void, ApiClientError, ChangePasswordPayload>({
    mutationFn: (payload) =>
      api.request<void>('/auth/change-password', { method: 'POST', json: payload }),
  });
}

// ───────────────────────────────── Blocks ─────────────────────────────────
export function useBlocks(): UseQueryResult<Block[], ApiClientError> {
  return useQuery<Block[], ApiClientError>({
    queryKey: BLOCKS_KEY,
    queryFn: () => api.request<Block[]>('/blocks'),
    staleTime: 30_000,
  });
}

export function useUnblock(): UseMutationResult<void, ApiClientError, string> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string>({
    mutationFn: (blockedUserId) =>
      api.request<void>(`/blocks/${blockedUserId}`, { method: 'DELETE' }),
    onMutate: async (blockedUserId) => {
      await queryClient.cancelQueries({ queryKey: BLOCKS_KEY });
      const previous = queryClient.getQueryData<Block[]>(BLOCKS_KEY);
      queryClient.setQueryData<Block[]>(BLOCKS_KEY, (old) =>
        (old ?? []).filter((b) => b.blockedUserId !== blockedUserId),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      const ctx = context as { previous?: Block[] } | undefined;
      if (ctx?.previous) queryClient.setQueryData(BLOCKS_KEY, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKS_KEY });
    },
  });
}

// ──────────────────────────── Delete account ──────────────────────────────
export function useDeleteAccount(): UseMutationResult<void, ApiClientError, void> {
  return useMutation<void, ApiClientError, void>({
    // GDPR / 152-ФЗ erasure lives on the users controller: DELETE /users/me.
    mutationFn: () => api.request<void>('/users/me', { method: 'DELETE' }),
  });
}
