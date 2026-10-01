import * as React from 'react'
import { cn } from '@/utils/cn'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn('focus-ring h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 placeholder:text-slate-400', className)}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn('focus-ring min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 placeholder:text-slate-400', className)}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
