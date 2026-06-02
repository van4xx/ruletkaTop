'use client';

/**
 * Login / register mutations.
 *
 * Both call the existing typed api client, persist the returned session into
 * the zustand auth store (which mirrors tokens to storage + the marker cookie),
 * seed the `/auth/me` query cache, and connect the realtime socket. Callers get
 * back a standard TanStack `useMutation` result (so they can show pending /
 * error states and run an `onSuccess` redirect).
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { AuthResponse, LoginDto, RegisterDto } from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { useAuthStore } from '@/lib/stores/auth-store';
import { CURRENT_USER_KEY } from './use-auth';

function useSessionEstablisher() {
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();

  return (res: AuthResponse) => {
    setSession({ user: res.user, tokens: res.tokens });
    queryClient.setQueryData(CURRENT_USER_KEY, res.user);
    connectSocket(res.tokens.accessToken);
  };
}

/** Email + password login. */
export function useLogin(): UseMutationResult<AuthResponse, ApiClientError, LoginDto> {
  const establish = useSessionEstablisher();
  return useMutation<AuthResponse, ApiClientError, LoginDto>({
    mutationFn: (dto) => api.auth.login(dto),
    onSuccess: establish,
  });
}

/** New-account registration (18+ enforced by the form + server). */
export function useRegister(): UseMutationResult<AuthResponse, ApiClientError, RegisterDto> {
  const establish = useSessionEstablisher();
  return useMutation<AuthResponse, ApiClientError, RegisterDto>({
    mutationFn: (dto) => api.auth.register(dto),
    onSuccess: establish,
  });
}
