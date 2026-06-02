/**
 * Unified modal system — public surface.
 *
 * Usage:
 *   import { ModalHost, useModal } from '@/components/modals';
 *
 *   // mount once (integrator does this in providers.tsx):
 *   <ModalHost />
 *
 *   // open from anywhere:
 *   const { open } = useModal();
 *   open('gift-picker', { toUserId, context: 'profile' });
 */

// Host (mount once) + the modal bodies (mostly used via the host, exported for
// direct use/testing).
export { ModalHost } from './modal-host';
export { FiltersModal } from './filters-modal';
export { GiftPickerModal } from './gift-picker-modal';
export { BuyCoinsModal } from './buy-coins-modal';
export { BuyTopModal } from './buy-top-modal';
export { PremiumModal } from './premium-modal';
export { ReportUserModal } from './report-user-modal';
export { BlockUserModal } from './block-user-modal';
export { AddFriendModal } from './add-friend-modal';
export { AvatarUploadModal } from './avatar-upload-modal';
export { SearchUsersModal } from './search-users-modal';
export { CallInviteModal } from './call-invite-modal';
export { DeviceSettingsModal } from './device-settings-modal';
export { ConfirmModal } from './confirm-modal';

// Store + typed hooks (the ergonomic way to drive modals app-wide).
export {
  useModal,
  useModalProps,
  useModalStore,
  type ModalType,
  type ModalProps,
  type ModalPropsMap,
  type ModalUserRef,
  type UseModalReturn,
} from '@/lib/stores/modal-store';

// Filters store (the FiltersModal persists here; the roulette reads it).
export { useFiltersStore, useMatchFilters, DEFAULT_FILTERS } from '@/lib/stores/filters-store';
