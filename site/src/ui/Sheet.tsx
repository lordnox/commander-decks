import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ComponentProps, ReactNode } from 'react'

export const Sheet = DialogPrimitive.Root
export const SheetTrigger = DialogPrimitive.Trigger
export const SheetClose = DialogPrimitive.Close

export const SheetContent = ({
  children,
  className = '',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { children: ReactNode }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in" />
    <DialogPrimitive.Content
      className={`fixed inset-y-0 right-0 z-50 flex w-[min(25rem,calc(100%-1rem))] flex-col border-l border-white/10 bg-ink-950 shadow-2xl shadow-black outline-none ${className}`}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
)

export const SheetTitle = DialogPrimitive.Title
export const SheetDescription = DialogPrimitive.Description
