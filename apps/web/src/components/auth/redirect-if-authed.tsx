'use client';

/**
 * Sends already-authenticated users away from the auth screens (login /
 * register) to the home page. Renders nothing. Middleware also enforces this at
 * the edge; this handles the in-app navigation / post-hydration case smoothly.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/use-auth';

export function RedirectIfAuthed(): null {
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isReady, isAuthenticated, router]);

  return null;
}
