import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function FloatingCard({
  title,
  note,
  icon,
  onDismiss,
  children,
}: {
  title: string
  note: string
  icon: ReactNode
  onDismiss: () => void
  children: ReactNode
}) {
  return (
    <aside
      className="animate-in fade-in-0 slide-in-from-bottom-2 fixed bottom-5 right-5 z-20 w-[min(370px,calc(100vw-2.5rem))] rounded-2xl border border-[#e1e6ef] bg-white/95 p-4 shadow-[0_16px_50px_rgba(37,51,73,0.16)] duration-300 backdrop-blur-sm sm:bottom-8 sm:right-8"
      aria-label={title}
    >
      <div className="mb-3 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#edf2ff] text-primary">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[#28374b]">{title}</h2>
          <p className="mt-1 text-sm leading-snug text-[#68758a]">{note}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={`Dismiss ${title}`}
          className="rounded-lg p-1 text-[#8b98aa] hover:bg-[#f1f3f8] hover:text-[#28374b]"
        >
          <X className="size-4" />
        </button>
      </div>
      {children}
    </aside>
  )
}
