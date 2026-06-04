'use client';

/**
 * Unified modal store for the whole app.
 *
 * One global zustand store owns "which modal is open + with what props". Any
 * component can open a modal imperatively from anywhere (event handlers, query
 * callbacks, socket listeners) without prop-drilling a controlled `open` flag:
 *
 * ```ts
 * const { open } = useModal();
 * open('gift-picker', { toUserId, context: 'profile' });
 * ```
 *
 * `<ModalHost/>` (mounted once in `providers.tsx`) reads this store and renders
 * the active modal inside the design-system `Dialog`. Each modal component owns
 * its own body/validation; the host owns the open/close lifecycle so closing
 * is consistent (Esc, overlay click, the ✕ button, and `close()` all funnel
 * through `close()` here).
 *
 * Typing: {@link ModalPropsMap} maps every {@link ModalType} to its props, so
 * `open(type, props)` is checked — passing the wrong props for a modal is a
 * compile error, and modals read their props through the typed
 * {@link useModalProps} selector.
 */
import { create } from 'zustand';
import type { GiftContext } from '@ruletka/shared-types';

// ───────────────────────────── Props per modal ────────────────────────────
/** Minimal peer/user descriptor reused by the social/call modals. */
export interface ModalUserRef {
  id: string;
  nickname?: string;
  avatarUrl?: string | null;
}

/**
 * The props each modal accepts. Add a modal by adding a key here — the
 * {@link ModalType} union, the {@link useModal} `open` overloads and the host
 * switch all derive from this map, so the compiler keeps them in sync.
 */
export interface ModalPropsMap {
  /** Matchmaking filters editor (persists to the filters store). */
  filters: Record<string, never>;
  /** Pick + send an animated gift to a user in a given context. */
  'gift-picker': {
    toUserId?: string;
    toNickname?: string;
    context?: GiftContext;
  };
  /**
   * Pick / buy / activate a profile-cover cosmetic. Always acts on the CALLER's
   * own profile (no target id), so it takes no props.
   */
  'cover-picker': Record<string, never>;
  /** Coin storefront → CloudPayments checkout. */
  'buy-coins': {
    /** Pre-select a package by its code. */
    presetPackageCode?: string;
    /** Coins the user is short by (shown as context when launched from a gate). */
    shortfall?: number;
  };
  /** Buy a Top-feed placement (lane + duration + coins). */
  'buy-top': {
    presetLane?: 'left' | 'right';
  };
  /** Premium plans + perks → recurrent CloudPayments. */
  premium: {
    /** Optional reason copy shown at the top (e.g. "this gift is premium-only"). */
    reason?: string;
  };
  /** Report a user for moderation. */
  'report-user': {
    userId: string;
    nickname?: string;
    /** Optional match/room id to attach to the report. */
    matchId?: string;
  };
  /** Confirm blocking a user. */
  'block-user': {
    userId: string;
    nickname?: string;
    /** Friendship id to also drop locally when the user is a friend. */
    friendshipId?: string;
    /** Fired after a successful block (e.g. to leave a call). */
    onBlocked?: () => void;
  };
  /** Send a friend request (by id, or pre-filled from a profile). */
  'add-friend': {
    presetUserId?: string;
    nickname?: string;
  };
  /** Pick/preview a new avatar image and save it. */
  'avatar-upload': {
    /** Current avatar, shown as the starting preview. */
    currentUrl?: string | null;
  };
  /** Search people and jump to their profile. */
  'search-users': Record<string, never>;
  /** Incoming direct call invite (caller info + accept/decline). */
  'call-invite': {
    callId: string;
    fromUserId: string;
    type: 'video' | 'voice';
    nickname?: string;
    avatarUrl?: string | null;
  };
  /** Camera / microphone device picker. */
  'device-settings': {
    /** Which kinds to show. Defaults to both. */
    kinds?: Array<'camera' | 'microphone'>;
  };
  /**
   * Generic confirmation dialog (logout, delete account, remove friend…).
   * Self-contained: the caller passes the copy + the confirm handler.
   */
  confirm: {
    title: string;
    body?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Use the destructive (danger) treatment for the confirm button. */
    danger?: boolean;
    /** Runs on confirm. May be async — the button shows a spinner until it settles. */
    onConfirm: () => void | Promise<void>;
    /** Runs on cancel/close (optional). */
    onCancel?: () => void;
  };
}

/** The union of all modal identifiers. */
export type ModalType = keyof ModalPropsMap;

/** Props for a specific modal type. */
export type ModalProps<T extends ModalType> = ModalPropsMap[T];

// ──────────────────────────────── Store ───────────────────────────────────
interface ModalState {
  /** The open modal's type, or `null` when nothing is open. */
  type: ModalType | null;
  /** Props for the open modal (loosely typed in the store; read typed via {@link useModalProps}). */
  props: Record<string, unknown>;
  /** Open a modal with its props. Prefer the typed {@link useModal} `open`. */
  open: (type: ModalType, props?: Record<string, unknown>) => void;
  /** Close the active modal and clear its props. */
  close: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  type: null,
  props: {},
  open: (type, props = {}) => set({ type, props }),
  close: () => set({ type: null, props: {} }),
}));

// ─────────────────────────── Typed public helper ──────────────────────────
/** A type-safe `open` whose props are checked against the modal `type`. */
export interface OpenModal {
  <T extends ModalType>(
    type: T,
    // No props required when the modal's props are `{}`/all-optional.
    ...args: Record<string, never> extends ModalProps<T>
      ? [props?: ModalProps<T>]
      : [props: ModalProps<T>]
  ): void;
}

export interface UseModalReturn {
  /** Open a modal (type-checked props). */
  open: OpenModal;
  /** Close the active modal. */
  close: () => void;
  /** The currently-open modal type (or `null`). */
  type: ModalType | null;
  /** Is *some* modal open? */
  isOpen: boolean;
}

/**
 * The ergonomic, fully-typed hook the whole app uses to drive modals.
 *
 * `open` is typed so the props must match the modal — e.g.
 * `open('report-user', { userId })` compiles, `open('report-user', {})` does not.
 */
export function useModal(): UseModalReturn {
  const type = useModalStore((s) => s.type);
  const open = useModalStore((s) => s.open) as unknown as OpenModal;
  const close = useModalStore((s) => s.close);
  return { open, close, type, isOpen: type !== null };
}

/**
 * Read the active modal's props, typed to the modal `T` the caller renders.
 * Each modal component calls `useModalProps<'report-user'>()` to get its props.
 */
export function useModalProps<T extends ModalType>(): ModalProps<T> {
  return useModalStore((s) => s.props) as ModalProps<T>;
}
