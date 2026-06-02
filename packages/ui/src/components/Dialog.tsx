'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Modal dialog built on Radix Dialog (focus trap, scroll lock, `Esc` to close,
 * and an accessible label/description contract). Enter/exit motion is driven by
 * Radix's `data-state` attributes via CSS so it composes cleanly with Radix's
 * own mount/unmount lifecycle and honors `prefers-reduced-motion`.
 *
 * @example
 * <Dialog>
 *   <DialogTrigger asChild><Button>Open</Button></DialogTrigger>
 *   <DialogContent>
 *     <DialogHeader>
 *       <DialogTitle>Send a gift</DialogTitle>
 *       <DialogDescription>Choose a gift to send.</DialogDescription>
 *     </DialogHeader>
 *     …
 *   </DialogContent>
 * </Dialog>
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

const overlayMotion =
  'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out';

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-[var(--z-overlay)] bg-background-base/70 backdrop-blur-md',
        overlayMotion,
        className,
      )}
      {...props}
    />
  );
});

const contentMotion =
  'data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out';

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Hide the built-in top-right close button (provide your own close action). */
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent({ className, children, hideClose = false, ...props }, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
          // Never exceed the viewport: tall modals (gift picker, buy coins,
          // premium, …) scroll WITHIN the panel instead of overflowing off-screen.
          'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain',
          'glass-strong rounded-2xl p-6 shadow-xl',
          'focus:outline-none',
          contentMotion,
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground',
              'transition-colors hover:bg-glass hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-5 flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('font-display text-xl font-semibold tracking-tight', className)}
      {...props}
    />
  );
});

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});

/** Convenience alias — `Modal` reads better at some call sites. */
export const Modal = Dialog;
