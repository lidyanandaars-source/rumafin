import * as React from 'react'
import { cn } from '@/utils/cn'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn('focus-ring h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950', className)} {...props}>
    {children}
  </select>
))
Select.displayName = 'Select'
