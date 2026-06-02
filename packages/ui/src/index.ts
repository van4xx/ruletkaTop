/**
 * @ruletka/ui — "Midnight Aurora" design system
 * ─────────────────────────────────────────────────────────────────────────
 * The visual identity of ruletka.top: token-driven, Radix-based, CVA-variant
 * React primitives plus the signature pieces (Marquee, CoinBalance,
 * CountrySelect) that define the product.
 *
 * Styles are shipped as CSS — import them once in your app's root stylesheet:
 *   @import '@ruletka/ui/styles/globals.css';
 *
 * Everything else (components + helpers) is exported from here.
 */

// ── Utilities ──
export { cn } from './lib/cn';
export {
  COUNTRIES,
  COUNTRY_BY_CODE,
  codeToFlag,
  type Country,
} from './lib/countries';

// ── Primitives ──
export { Button, buttonVariants, type ButtonProps } from './components/Button';
export { IconButton, iconButtonVariants, type IconButtonProps } from './components/IconButton';
export {
  Card,
  GlassCard,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardVariants,
  type CardProps,
} from './components/Card';
export { Input, type InputProps } from './components/Input';
export { Textarea, type TextareaProps } from './components/Textarea';
export { Label, type LabelProps } from './components/Label';
export { Badge, badgeVariants, type BadgeProps } from './components/Badge';
export { Skeleton, type SkeletonProps } from './components/Skeleton';
export { Spinner, type SpinnerProps } from './components/Spinner';

// ── Overlays & navigation ──
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Modal,
  type DialogContentProps,
} from './components/Dialog';
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from './components/DropdownMenu';
export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsListProps } from './components/Tabs';
export {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from './components/Tooltip';

// ── Inputs ──
export { Switch, type SwitchProps } from './components/Switch';
export { Slider, type SliderProps } from './components/Slider';
export {
  CountrySelect,
  type CountrySelectProps,
} from './components/CountrySelect';

// ── Identity & feedback ──
export {
  Avatar,
  AvatarGroup,
  type AvatarProps,
  type AvatarGroupProps,
} from './components/Avatar';
export {
  Toaster,
  toast,
  useToasts,
  type ToasterProps,
  type ToastOptions,
  type ToastVariant,
} from './components/Toast';

// ── Signature pieces ──
export { Marquee, type MarqueeProps } from './components/Marquee';
export {
  CoinIcon,
  CoinBalance,
  type CoinIconProps,
  type CoinBalanceProps,
} from './components/Coin';
