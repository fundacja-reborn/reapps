import type { Component } from 'svelte';
import {
  Archive,
  BookOpen,
  Bookmark,
  Briefcase,
  Calendar,
  Camera,
  Code,
  Dumbbell,
  GraduationCap,
  Heart,
  House,
  Leaf,
  Lightbulb,
  Lock,
  Music,
  Plane,
  ShoppingCart,
  SquareCheck,
  Star,
  User,
  Users,
  Utensils,
  Wallet,
  Wrench
} from '@lucide/svelte';
import { isFolderIcon, type FolderIconKey } from '$lib/utils/folder-icons';

type IconComponent = Component<{ class?: string }>;

/** Lucide component per folder icon key. Typed as a full record, so a key without a component fails svelte-check. */
export const FOLDER_ICON_COMPONENTS: Record<FolderIconKey, IconComponent> = {
  briefcase: Briefcase,
  house: House,
  user: User,
  users: Users,
  heart: Heart,
  star: Star,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  lightbulb: Lightbulb,
  code: Code,
  wrench: Wrench,
  calendar: Calendar,
  'square-check': SquareCheck,
  archive: Archive,
  bookmark: Bookmark,
  music: Music,
  camera: Camera,
  plane: Plane,
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  dumbbell: Dumbbell,
  wallet: Wallet,
  lock: Lock,
  leaf: Leaf
};

/** Component for a stored key; `undefined` for no icon or a key this build does not know. */
export function folderIconComponent(icon: string | undefined): IconComponent | undefined {
  return isFolderIcon(icon) ? FOLDER_ICON_COMPONENTS[icon] : undefined;
}
