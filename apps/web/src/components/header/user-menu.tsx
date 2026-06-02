'use client';

/**
 * Avatar dropdown — the home for secondary destinations (Профиль, Чаты,
 * Кошелёк, Настройки) and the sign-out action, per the brief's "no redundant
 * links" rule.
 *
 * Built on the design-system Radix `DropdownMenu`: full keyboard navigation
 * (arrows, type-ahead, `Esc`), focus management, collision-aware positioning
 * and the shared popover motion. The trigger is the user's avatar (aurora ring
 * for premium members) with a presence dot; it exposes `aria-expanded`/
 * `aria-haspopup` via Radix.
 */
import { memo, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Crown, LogOut } from 'lucide-react';
import type { AuthUser } from '@ruletka/shared-types';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ruletka/ui';
import { USER_MENU } from '@/config/nav';
import { cn } from '@/lib/cn';

interface UserMenuProps {
  user: AuthUser;
  /** Revokes the session; provided by the header (from `useAuth`). */
  onLogout: () => Promise<void>;
}

function UserMenuImpl({ user, onLogout }: UserMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onLogout();
    } finally {
      // Land on the marketing home after sign-out regardless of outcome.
      router.push('/');
      router.refresh();
    }
  }, [onLogout, router, signingOut]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Меню профиля"
          className={cn(
            'group inline-flex items-center rounded-full outline-none',
            'transition-transform duration-200 hover:scale-[1.03] active:scale-95',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-background',
          )}
        >
          <Avatar
            size="sm"
            alt={user.nickname}
            ring={user.isPremium ? 'aurora' : 'none'}
            status="online"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={10} className="w-60">
        {/* Identity header */}
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar
            size="md"
            alt={user.nickname}
            ring={user.isPremium ? 'aurora' : 'none'}
          />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {user.nickname}
              </span>
              {user.isPremium && (
                <Crown
                  className="h-3.5 w-3.5 shrink-0 text-warning"
                  aria-label="Премиум"
                />
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel>Аккаунт</DropdownMenuLabel>
        {USER_MENU.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.key} asChild>
              <Link href={item.href} className="cursor-pointer">
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={signingOut}
          // Keep the menu's focus contract intact, then run sign-out.
          onSelect={(e) => {
            e.preventDefault();
            void handleLogout();
          }}
          className="cursor-pointer"
        >
          <LogOut aria-hidden="true" />
          <span>{signingOut ? 'Выходим…' : 'Выйти'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const UserMenu = memo(UserMenuImpl);
