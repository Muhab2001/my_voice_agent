import type { TranscriptItem } from '../transports/types'

export function LiveCaptions({ items }: { items: TranscriptItem[] }) {
  return (
    <div
      className="flex w-full flex-col items-center justify-end gap-2 text-center"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {items.map((item) => (
        <p
          key={item.id}
          className={`text-[18px] leading-snug font-medium tracking-[-0.02em] text-[#43516b] transition-all duration-700 ease-in-out sm:text-[22px] ${item.fading ? '-translate-y-2 opacity-0' : 'animate-in fade-in-0 slide-in-from-bottom-2 translate-y-0 opacity-100 duration-500'}`}
        >
          {item.text}
        </p>
      ))}
    </div>
  )
}
