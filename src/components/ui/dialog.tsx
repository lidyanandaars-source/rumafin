import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-sm" />
        <DialogPrimitive.Content className={cn('fixed inset-x-3 bottom-3 z-50 max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl md:left-1/2 md:top-1/2 md:bottom-auto md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2', className)}>
          <div className="pr-10">
            <DialogPrimitive.Title className="text-xl font-bold text-slate-950">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-1 text-sm text-slate-500">{description}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="focus-ring absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Tutup">
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
          <div className="mt-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
