import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cn } from '../../lib/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({ className, ...props }: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content className={cn('ui-menu-content', className)} sideOffset={6} {...props} /></DropdownMenuPrimitive.Portal>;
}
export function DropdownMenuItem({ className, ...props }: DropdownMenuPrimitive.DropdownMenuItemProps) {
  return <DropdownMenuPrimitive.Item className={cn('ui-menu-item', className)} {...props} />;
}
export const DropdownMenuSeparator = (props: DropdownMenuPrimitive.DropdownMenuSeparatorProps) => <DropdownMenuPrimitive.Separator className="ui-menu-separator" {...props} />;
