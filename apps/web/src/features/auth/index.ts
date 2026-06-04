/**
 * Public API of the auth feature. Other features should import from here.
 */
export {
  loginFormSchema,
  registerFormSchema,
  forgotPasswordFormSchema,
  resetPasswordFormSchema,
  ageFromBirthDate,
  MIN_AGE,
  GENDER_OPTIONS,
  LOCALE_OPTIONS,
  type LoginFormValues,
  type RegisterFormValues,
  type ForgotPasswordFormValues,
  type ResetPasswordFormValues,
} from './schemas';
export {
  useAuth,
  useCurrentUser,
  useAuthBootstrap,
  CURRENT_USER_KEY,
  type UseAuthResult,
} from './use-auth';
export { useLogin, useRegister } from './use-auth-mutations';
export {
  useRequestPasswordReset,
  useResetPassword,
  useVerifyEmail,
  useResendVerification,
} from './use-auth-email';
export { AuthBootstrapper } from './auth-bootstrapper';
export { SessionExpiryWatcher } from './session-expiry-watcher';
export { RequireAuth } from './require-auth';
