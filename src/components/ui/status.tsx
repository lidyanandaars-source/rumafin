import { LoaderCircle, WifiOff } from 'lucide-react'

export function LoadingState({ label = 'Memuat…' }: { label?: string }) {
  return <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />{label}</div>
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p className="font-semibold text-slate-900">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div>
}

export function OfflineBanner() {
  return <div className="flex items-center justify-center gap-2 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"><WifiOff className="h-4 w-4" />Offline — entri manual dapat disimpan sebagai draft lokal.</div>
}
