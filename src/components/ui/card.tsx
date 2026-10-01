import type { HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pb-2', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-3', className)} {...props} />
}
