import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'

export const Switch = ({
  className = '',
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={`group inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-white/15 bg-white/10 p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold-300 disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:border-gold-300/60 data-[state=checked]:bg-gold-300 ${className}`}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-stone-300 shadow-sm transition-transform group-data-[state=checked]:translate-x-5 group-data-[state=checked]:bg-ink-950" />
  </SwitchPrimitive.Root>
)
