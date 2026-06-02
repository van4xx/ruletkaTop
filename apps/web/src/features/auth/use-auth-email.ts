'use client';

/**
 * Email-link auth mutations: password reset (request → reset) and email
 * verification (verify-from-link → resend).
 *
 * Thin TanStack `useMutation` wrappers over the typed api client's `authEmail`
 * group, so the landing pages + the "verify your email" banner get standard
 * pending/error/success states. No changes to the shared api/socket libs.
 *
 * Side effects worth noting:
 *  - {@link useVerifyEmail} and {@link useResendVerification} invalidate the
 *    `/auth/me` query on success, so a freshly-verified session re-fetches the
 *    user and the `emailVerified` banner dismisses itself without a reload.
 *  - {@link useRequestPasswordReset} is intentionally non-enumerating: it always
 *    resolves (the API 204s for unknown addresses too), so the page can show one
 *    neutral "if that email exists…" success regardless of the outcome.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type {
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';
import { CURRENT_USER_KEY } from './use-auth';

/** Request a password-reset email. Always resolves (no account enumeration). */
export function useRequestPasswordReset(): UseMutationResult<
  void,
  ApiClientError,
  RequestPasswordResetDto
> {
  return useMutation<void, ApiClientError, RequestPasswordResetDto>({
    mutationFn: (dto) => api.authEmail.requestPasswordReset(dto),
  });
}

/** Complete a password reset using the single-use token from the email. */
export function useResetPassword(): UseMutationResult<void, ApiClientError, ResetPasswordDto> {
  return useMutation<void, ApiClientError, ResetPasswordDto>({
    mutationFn: (dto) => api.authEmail.resetPassword(dto),
  });
}

/** Confirm an email address from the emailed verification token. */
export function useVerifyEmail(): UseMutationResult<void, ApiClientError, VerifyEmailDto> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiClientError, VerifyEmailDto>({
    mutationFn: (dto) => api.authEmail.verifyEmail(dto),
    onSuccess: () => {
      // The session's `emailVerified` just flipped server-side — re-fetch the
      // user so any mounted "verify your email" banner disappears.
      void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
    },
  });
}

/** Re-send the verification email to the signed-in user. */
export function useResendVerification(): UseMutationResult<void, ApiClientError, void> {
  return useMutation<void, ApiClientError, void>({
    mutationFn: () => api.authEmail.resendVerification(),
  });
}
