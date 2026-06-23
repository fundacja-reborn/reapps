// Utility functions
export { cn } from './utils/cn';
export { flyAndScale } from './utils/transition';

// Stores
export { toastStore } from './stores/toast';
export type {
  Toast as ToastType,
  ToastVariant,
  ToastAction as ToastActionType
} from './stores/toast';

// Original components
export {
  Button,
  buttonVariants,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant
} from './components/button';

export { Input } from './components/input';

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from './components/card';

export { LoadingSpinner } from './components/loading-spinner';

// Auth components
export * from './components/auth';

// Icon components
export * from './components/icons';

// New shadcn-svelte components - export only named exports to avoid conflicts
export {
  // Alert
  Alert,
  AlertDescription,
  AlertTitle,
  alertVariants,
  type AlertVariant
} from './components/alert';

export {
  // Avatar
  Avatar,
  AvatarImage,
  AvatarFallback
} from './components/avatar';

export {
  // Badge
  Badge,
  badgeVariants
} from './components/badge';

export {
  // Breadcrumb
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from './components/breadcrumb';

export {
  // Checkbox
  Checkbox,
  type CheckboxProps
} from './components/checkbox';

export {
  // Context Menu
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupHeading,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from './components/context-menu';

export {
  // Dialog
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
} from './components/dialog';

export {
  // Dropdown Menu
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupHeading,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './components/dropdown-menu';

export {
  // Label
  Label
} from './components/label';

export {
  // RadioGroup
  RadioGroup,
  RadioGroupItem
} from './components/radio-group';

export {
  Root as Select,
  Group as SelectGroup,
  Label as SelectLabel,
  Item as SelectItem,
  Content as SelectContent,
  Trigger as SelectTrigger,
  Separator as SelectSeparator,
  ScrollDownButton as SelectScrollDownButton,
  ScrollUpButton as SelectScrollUpButton,
  GroupHeading as SelectGroupHeading
} from './components/select';

export {
  // Separator
  Separator
} from './components/separator';

export {
  // Sheet
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription
} from './components/sheet';

export {
  // Sidebar
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar
} from './components/sidebar';

export {
  // Skeleton
  Skeleton
} from './components/skeleton';

export {
  // Sonner
  Sonner,
  toast
} from './components/sonner';

export {
  // Toast
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle
} from './components/toast';

export {
  // Toaster
  Toaster
} from './components/toast';

export {
  // Toggle
  Toggle,
  toggleVariants
} from './components/toggle';

export {
  // Tooltip
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './components/tooltip';

// Calendar
export {
  Calendar,
  Cell as CalendarCell,
  Day as CalendarDay,
  Grid as CalendarGrid,
  Header as CalendarHeader,
  Months as CalendarMonths,
  GridRow as CalendarGridRow,
  Heading as CalendarHeading,
  GridBody as CalendarGridBody,
  GridHead as CalendarGridHead,
  HeadCell as CalendarHeadCell,
  NextButton as CalendarNextButton,
  PrevButton as CalendarPrevButton
} from './components/calendar';

// Re-export types
export type { ClassValue } from 'clsx';

// Hooks
export { IsMobile } from './hooks/is-mobile.svelte';

// Nowe shadcn-svelte komponenty - eksporty całościowe
export {
  Root as Accordion,
  Content as AccordionContent,
  Item as AccordionItem,
  Trigger as AccordionTrigger
} from './components/accordion';

export {
  Root as Drawer,
  NestedRoot as DrawerNestedRoot,
  Content as DrawerContent,
  Description as DrawerDescription,
  Overlay as DrawerOverlay,
  Footer as DrawerFooter,
  Header as DrawerHeader,
  Title as DrawerTitle,
  Trigger as DrawerTrigger,
  Portal as DrawerPortal,
  Close as DrawerClose
} from './components/drawer';

export {
  Root as NavigationMenuRoot,
  Content as NavigationMenuContent,
  Indicator as NavigationMenuIndicator,
  Item as NavigationMenuItem,
  Link as NavigationMenuLink,
  List as NavigationMenuList,
  Trigger as NavigationMenuTrigger,
  Viewport as NavigationMenuViewport
} from './components/navigation-menu';

export {
  Root as InputOTP,
  Group as InputOTPGroup,
  Slot as InputOTPSlot,
  Separator as InputOTPSeparator
} from './components/input-otp';

export {
  Root as Tabs,
  Content as TabsContent,
  List as TabsList,
  Trigger as TabsTrigger
} from './components/tabs';

export { Root as ToggleGroup, Item as ToggleGroupItem } from './components/toggle-group';

export {
  Root as Menubar,
  CheckboxItem as MenubarCheckboxItem,
  Content as MenubarContent,
  Item as MenubarItem,
  GroupHeading as MenubarGroupHeading,
  RadioItem as MenubarRadioItem,
  Separator as MenubarSeparator,
  Shortcut as MenubarShortcut,
  SubContent as MenubarSubContent,
  SubTrigger as MenubarSubTrigger,
  Trigger as MenubarTrigger,
  Menu as MenubarMenu,
  Group as MenubarGroup,
  Sub as MenubarSub,
  RadioGroup as MenubarRadioGroup
} from './components/menubar';

export {
  Root as Pagination,
  Content as PaginationContent,
  Item as PaginationItem,
  Link as PaginationLink,
  PrevButton as PaginationPrevButton,
  NextButton as PaginationNextButton,
  Ellipsis as PaginationEllipsis
} from './components/pagination';

export { Root as Slider } from './components/slider';

export { Root as Switch } from './components/switch';

export { Root as Textarea } from './components/textarea';

export {
  // Popover
  Root as Popover,
  Content as PopoverContent,
  Trigger as PopoverTrigger,
  Close as PopoverClose
} from './components/popover';

export {
  // Progress
  Progress
} from './components/progress';

// Sidebar exports
// (Usunięto pojedyncze eksporty, eksportuj tylko zbiorczo powyżej)

export {
  // Settings components
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsLayout,
  ThemePicker,
  DateTimeFormatCard
} from './components/settings';

// What's new (release notes) dialog
export { WhatsNewDialog } from './components/whats-new';

// Time Field
export { TimeFieldInput } from './components/time-field';

// Mobile Time Picker
export { MobileTimePicker } from './components/mobile-time-picker';
