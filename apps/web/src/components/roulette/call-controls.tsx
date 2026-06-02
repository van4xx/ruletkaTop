'use client';

/**
 * The floating call control bar shared by /video and /voice.
 *
 * - Primary action: a single Start → Next button (the product's core loop).
 * - Media toggles: mic always, camera only in video mode.
 * - Social actions: gift, add friend, chat, plus a "more" menu (report/block).
 * - Stop ends the session entirely.
 *
 * Icon-only controls are wrapped in tooltips and carry `aria-label`s.
 */
import {
  Flag,
  Gift,
  MessageCircle,
  Mic,
  MicOff,
  MoreVertical,
  PhoneOff,
  Play,
  SkipForward,
  UserPlus,
  UserX,
  Video,
  VideoOff,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@ruletka/ui';
import type { RouletteStatus } from '@/features/roulette/types';
import { cn } from '@/lib/cn';

export interface CallControlsProps {
  status: RouletteStatus;
  isVideo: boolean;
  micMuted: boolean;
  cameraOff: boolean;
  isStarting: boolean;
  /** True when a peer is currently connected (enables social actions). */
  hasPeer: boolean;
  chatOpen: boolean;
  onStart: () => void;
  onNext: () => void;
  onStop: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onGift: () => void;
  onAddFriend: () => void;
  onToggleChat: () => void;
  onReport: () => void;
  onBlock: () => void;
}

function ControlButton({
  label,
  active,
  danger,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={label}
          aria-pressed={active}
          variant={danger ? 'danger' : active ? 'primary' : 'glass'}
          size="lg"
          shape="circle"
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </IconButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function CallControls(props: CallControlsProps) {
  const {
    status,
    isVideo,
    micMuted,
    cameraOff,
    isStarting,
    hasPeer,
    chatOpen,
    onStart,
    onNext,
    onStop,
    onToggleMic,
    onToggleCamera,
    onGift,
    onAddFriend,
    onToggleChat,
    onReport,
    onBlock,
  } = props;

  const idle = status === 'idle' || status === 'error';
  const active = !idle; // session running (searching/connecting/connected/ended)

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'glass-panel pointer-events-auto mx-auto flex w-full max-w-fit items-center gap-2 rounded-full p-2 shadow-xl sm:gap-3',
        )}
      >
        {/* Media toggles (only while a session is active) */}
        {active && (
          <>
            <ControlButton
              label={micMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              active={micMuted}
              danger={micMuted}
              onClick={onToggleMic}
            >
              {micMuted ? <MicOff /> : <Mic />}
            </ControlButton>

            {isVideo && (
              <ControlButton
                label={cameraOff ? 'Включить камеру' : 'Выключить камеру'}
                active={cameraOff}
                danger={cameraOff}
                onClick={onToggleCamera}
              >
                {cameraOff ? <VideoOff /> : <Video />}
              </ControlButton>
            )}
          </>
        )}

        {/* Primary action */}
        {idle ? (
          <Button
            variant="primary"
            size="lg"
            onClick={onStart}
            loading={isStarting}
            className="gap-2 rounded-full px-8"
          >
            <Play className="h-5 w-5" />
            Начать
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={onNext}
            className="gap-2 rounded-full px-7"
          >
            <SkipForward className="h-5 w-5" />
            Дальше
          </Button>
        )}

        {/* Social actions (enabled when connected to a peer) */}
        {active && (
          <>
            <ControlButton label="Подарок" onClick={onGift} disabled={!hasPeer}>
              <Gift />
            </ControlButton>

            <ControlButton label="В друзья" onClick={onAddFriend} disabled={!hasPeer}>
              <UserPlus />
            </ControlButton>

            <ControlButton
              label="Чат"
              active={chatOpen}
              onClick={onToggleChat}
              disabled={!hasPeer}
            >
              <MessageCircle />
            </ControlButton>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="Ещё"
                      variant="glass"
                      size="lg"
                      shape="circle"
                      disabled={!hasPeer}
                    >
                      <MoreVertical />
                    </IconButton>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Ещё</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onReport}>
                  <Flag className="h-4 w-4" />
                  Пожаловаться
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={onBlock}>
                  <UserX className="h-4 w-4" />
                  Заблокировать
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* Stop (only while active) */}
        {active && (
          <ControlButton label="Завершить" danger onClick={onStop}>
            <PhoneOff />
          </ControlButton>
        )}
      </div>
    </TooltipProvider>
  );
}
