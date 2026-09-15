import { Switch } from './ui/Switch'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from './ui/Sheet'

const ControlSwitch = ({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) => (
  <div className="flex items-start justify-between gap-5 py-3">
    <label htmlFor={id} className="cursor-pointer">
      <span className="block text-sm font-semibold text-stone-100">{label}</span>
      <span className="mt-1 block text-xs leading-5 text-stone-500">{description}</span>
    </label>
    <Switch
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
    />
  </div>
)

export const LiveControlsDrawer = ({
  historyCount,
  historyCursor,
  hasGameLog,
  planVisible,
  holding,
  alwaysStop,
  canSend,
  canOpenHand,
  onPrevious,
  onNext,
  onGameLog,
  onPlanVisibleChange,
  onHoldingChange,
  onAlwaysStopChange,
  onCopyPublicLink,
  onOpenHand,
}: {
  historyCount: number
  historyCursor: number
  hasGameLog: boolean
  planVisible: boolean
  holding: boolean
  alwaysStop: boolean
  canSend: boolean
  canOpenHand: boolean
  onPrevious: () => void
  onNext: () => void
  onGameLog: () => void
  onPlanVisibleChange: (visible: boolean) => void
  onHoldingChange: (holding: boolean) => void
  onAlwaysStopChange: (always: boolean) => void
  onCopyPublicLink: () => void
  onOpenHand: () => void
}) => (
  <Sheet>
    <SheetTrigger asChild>
      <button
        type="button"
        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-stone-200 hover:bg-white/10 hover:text-white"
      >
        Controls
      </button>
    </SheetTrigger>
    <SheetContent>
      <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
        <div>
          <SheetTitle className="font-display text-xl text-stone-50">
            Table controls
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs text-stone-500">
            View, automation, history, and sharing
          </SheetDescription>
        </div>
        <SheetClose asChild>
          <button
            type="button"
            className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
          >
            Close
          </button>
        </SheetClose>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <section className="border-b border-white/10 pb-4">
          <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
            View
          </h3>
          <ControlSwitch
            id="show-live-plan"
            label="Show plan"
            description="Keep the message composer visible below the table."
            checked={planVisible}
            onCheckedChange={onPlanVisibleChange}
          />
        </section>

        {canSend && (
          <section className="border-b border-white/10 py-4">
            <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
              Priority
            </h3>
            <ControlSwitch
              id="hold-priority"
              label="Pass until my turn"
              description="Auto-pass empty windows, but wake for a spell on the stack and for your turn."
              checked={holding}
              onCheckedChange={onHoldingChange}
            />
            <ControlSwitch
              id="always-stop-priority"
              label="Always stop on priority"
              description="Offer every priority window, including opportunities for table talk."
              checked={alwaysStop}
              onCheckedChange={onAlwaysStopChange}
            />
          </section>
        )}

        <section className="border-b border-white/10 py-4">
          <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
            History
          </h3>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              onClick={onPrevious}
              disabled={historyCount < 2 || historyCursor <= 0}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 disabled:opacity-35"
            >
              Previous
            </button>
            <span className="px-1 text-xs text-stone-500">
              {historyCount ? historyCursor + 1 : 0}/{historyCount}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={historyCount < 2 || historyCursor >= historyCount - 1}
              className="rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10 disabled:opacity-35"
            >
              Next
            </button>
          </div>
          {hasGameLog && (
            <SheetClose asChild>
              <button
                type="button"
                onClick={onGameLog}
                className="mt-2 w-full rounded-xl bg-white/5 px-3 py-2 text-sm font-semibold text-stone-300 hover:bg-white/10"
              >
                Open game log
              </button>
            </SheetClose>
          )}
        </section>

        <section className="pt-4">
          <h3 className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-gold-300">
            Table
          </h3>
          {canOpenHand && (
            <SheetClose asChild>
              <button
                type="button"
                onClick={onOpenHand}
                className="mt-3 w-full rounded-xl bg-gold-300 px-3 py-2 text-sm font-black text-ink-950 hover:bg-gold-200"
              >
                Opening hand
              </button>
            </SheetClose>
          )}
          <button
            type="button"
            onClick={onCopyPublicLink}
            className="mt-2 w-full rounded-xl bg-moss-300 px-3 py-2 text-sm font-black text-ink-950 hover:bg-gold-300"
          >
            Copy public link
          </button>
        </section>
      </div>
    </SheetContent>
  </Sheet>
)
