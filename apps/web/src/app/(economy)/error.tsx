'use client';

/**
 * Scoped error boundary for the (economy) route group (top / gifts / premium /
 * wallet / coins). Isolates a crash to this subtree and offers a `reset()`
 * retry. See {@link RouteError}.
 */
export { RouteError as default } from '@/components/system/route-error';
