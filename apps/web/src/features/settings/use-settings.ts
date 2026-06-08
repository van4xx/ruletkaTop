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
  AuthSession,
  BlockedUser,
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
export const SESSIONS_KEY = ['auth', 'sessions'] as const;

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

// ──────────────────────── Active sessions / devices ────────────────────────
/**
 * The current user's active logins (`GET /auth/sessions`). Each entry is one
 * device/login; the requesting device is flagged `current`. Kept fresh on
 * focus/mount so a revoke elsewhere reflects quickly.
 */
export function useSessions(): UseQueryResult<AuthSession[], ApiClientError> {
  return useQuery<AuthSession[], ApiClientError>({
    queryKey: SESSIONS_KEY,
    queryFn: () => api.request<AuthSession[]>('/auth/sessions'),
    staleTime: 15_000,
  });
}

/** Revoke ONE session (`DELETE /auth/sessions/:id`) with optimistic removal. */
export function useRevokeSession(): UseMutationResult<void, ApiClientError, string> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, string, { previous?: AuthSession[] }>({
    mutationFn: (id) => api.request<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_KEY });
      const previous = queryClient.getQueryData<AuthSession[]>(SESSIONS_KEY);
      queryClient.setQueryData<AuthSession[]>(SESSIONS_KEY, (old) =>
        (old ?? []).filter((s) => s.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(SESSIONS_KEY, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

/**
 * Revoke ALL other sessions (`DELETE /auth/sessions`), keeping the current
 * device. Optimistically drops every non-current entry.
 */
export function useRevokeOtherSessions(): UseMutationResult<void, ApiClientError, void> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, void, { previous?: AuthSession[] }>({
    mutationFn: () => api.request<void>('/auth/sessions', { method: 'DELETE' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: SESSIONS_KEY });
      const previous = queryClient.getQueryData<AuthSession[]>(SESSIONS_KEY);
      queryClient.setQueryData<AuthSession[]>(SESSIONS_KEY, (old) =>
        (old ?? []).filter((s) => s.current),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(SESSIONS_KEY, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });
}

// ───────────────────────────────── Blocks ─────────────────────────────────
// `GET /blocks` now returns each blocked user enriched with their minimal public
// identity (nickname + avatar), so the blocklist UI is readable rather than
// showing a raw hex id.
export function useBlocks(): UseQueryResult<BlockedUser[], ApiClientError> {
  return useQuery<BlockedUser[], ApiClientError>({
    queryKey: BLOCKS_KEY,
    queryFn: () => api.request<BlockedUser[]>('/blocks'),
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
      const previous = queryClient.getQueryData<BlockedUser[]>(BLOCKS_KEY);
      queryClient.setQueryData<BlockedUser[]>(BLOCKS_KEY, (old) =>
        (old ?? []).filter((b) => b.blockedUserId !== blockedUserId),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      const ctx = context as { previous?: BlockedUser[] } | undefined;
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
