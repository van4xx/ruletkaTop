'use client';

/**
 * Scoped error boundary for the (app) route group. Isolates a crash in the
 * authenticated hub to this subtree (the global chrome stays mounted) and offers
 * a `reset()` retry. See {@link RouteError}.
 */
export { RouteError as default } from '@/components/system/route-error';
