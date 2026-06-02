'use client';

/**
 * Single mount point for the whole app's modals.
 *
 * Reads {@link useModalStore} for the active modal and renders it inside ONE
 * design-system `Dialog`, so open/close (Esc, overlay click, the ✕ button, and
 * the store's `close()`) is consistent for every modal. Each modal body is a
 * separate component, code-split via `React.lazy` so a modal's code only loads
 * the first time it's opened — the initial bundle stays lean.
 *
 * The host also owns the GLOBAL incoming-call listener: a `call:invite` socket
 * event opens the {@link CallInviteModal} from anywhere in the app.
 *
 * Mount once near the root (the integrator adds `<ModalHost/>` to
 * `providers.tsx`).
 */
import { Suspense, lazy, useCallback, type ComponentType } from 'react';
import { Dialog, DialogContent, Spinner } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { useModalStore, type ModalType } from '@/lib/stores/modal-store';
import { useSocketEvent } from '@/features/chat/lib/use-socket';

// ── Code-split modal bodies ──
const FiltersModal = lazy(() =>
  import('./filters-modal').then((m) => ({ default: m.FiltersModal })),
);
const GiftPickerModal = lazy(() =>
  import('./gift-picker-modal').then((m) => ({ default: m.GiftPickerModal })),
);
const BuyCoinsModal = lazy(() =>
  import('./buy-coins-modal').then((m) => ({ default: m.BuyCoinsModal })),
);
const BuyTopModal = lazy(() => import('./buy-top-modal').then((m) => ({ default: m.BuyTopModal })));
const PremiumModal = lazy(() =>
  import('./premium-modal').then((m) => ({ default: m.PremiumModal })),
);
const ReportUserModal = lazy(() =>
  import('./report-user-modal').then((m) => ({ default: m.ReportUserModal })),
);
const BlockUserModal = lazy(() =>
  import('./block-user-modal').then((m) => ({ default: m.BlockUserModal })),
);
const AddFriendModal = lazy(() =>
  import('./add-friend-modal').then((m) => ({ default: m.AddFriendModal })),
);
const AvatarUploadModal = lazy(() =>
  import('./avatar-upload-modal').then((m) => ({ default: m.AvatarUploadModal })),
);
const SearchUsersModal = lazy(() =>
  import('./search-users-modal').then((m) => ({ default: m.SearchUsersModal })),
);
const CallInviteModal = lazy(() =>
  import('./call-invite-modal').then((m) => ({ default: m.CallInviteModal })),
);
const DeviceSettingsModal = lazy(() =>
  import('./device-settings-modal').then((m) => ({ default: m.DeviceSettingsModal })),
);
const ConfirmModal = lazy(() =>
  import('./confirm-modal').then((m) => ({ default: m.ConfirmModal })),
);

/** Registry: modal type → its lazy body component. */
const REGISTRY: Record<ModalType, ComponentType> = {
  filters: FiltersModal,
  'gift-picker': GiftPickerModal,
  'buy-coins': BuyCoinsModal,
  'buy-top': BuyTopModal,
  premium: PremiumModal,
  'report-user': ReportUserModal,
  'block-user': BlockUserModal,
  'add-friend': AddFriendModal,
  'avatar-upload': AvatarUploadModal,
  'search-users': SearchUsersModal,
  'call-invite': CallInviteModal,
  'device-settings': DeviceSettingsModal,
  confirm: ConfirmModal,
};

/** Per-modal dialog sizing (Tailwind max-width on the DialogContent). */
const SIZE: Partial<Record<ModalType, string>> = {
  'gift-picker': 'max-w-xl',
  'buy-coins': 'max-w-xl',
  'buy-top': 'max-w-xl',
  premium: 'max-w-xl',
  'search-users': 'max-w-xl',
  'device-settings': 'max-w-xl',
  'call-invite': 'max-w-sm',
};

/** Modals that should NOT close on outside click / Esc (must be answered). */
const REQUIRE_ACTION: Partial<Record<ModalType, boolean>> = {
  'call-invite': true,
};

export function ModalHost() {
  const type = useModalStore((s) => s.type);
  const close = useModalStore((s) => s.close);
  const openModal = useModalStore((s) => s.open);

  // Global incoming-call listener → opens the call-invite modal from anywhere.
  useSocketEvent(
    'call:invite',
    useCallback(
      (payload) => {
        openModal('call-invite', {
          callId: payload.callId,
          fromUserId: payload.fromUserId,
          type: payload.type,
        });
      },
      [openModal],
    ),
  );

  const ActiveModal = type ? REGISTRY[type] : null;
  const locked = type ? REQUIRE_ACTION[type] : false;

  return (
    <Dialog
      open={type !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {ActiveModal && (
        <DialogContent
          className={cn('w-[calc(100vw-2rem)]', type && SIZE[type])}
          hideClose={locked}
          // For must-answer modals (incoming call), block Esc + outside-click.
          onEscapeKeyDown={locked ? (e) => e.preventDefault() : undefined}
          onPointerDownOutside={locked ? (e) => e.preventDefault() : undefined}
          onInteractOutside={locked ? (e) => e.preventDefault() : undefined}
        >
          <Suspense
            fallback={
              <div className="grid place-items-center py-12">
                <Spinner />
              </div>
            }
          >
            <ActiveModal />
          </Suspense>
        </DialogContent>
      )}
    </Dialog>
  );
}
