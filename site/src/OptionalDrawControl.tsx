import { OPTIONAL_DRAW_MODE, isOptionalDrawMode } from '../../shared/optionalDraw'
import type { OptionalDrawMode } from '../../shared/optionalDraw'

export const OptionalDrawControl = ({ label, mode, disabled, onChange }: {
  label: string
  mode: OptionalDrawMode
  disabled?: boolean
  onChange: (mode: OptionalDrawMode) => void
}) => (
  <label className="flex flex-wrap items-center gap-3 text-sm text-stone-200">
    <span>{label}</span>
    <select
      aria-label={`${label}: optional draw preference`}
      className="rounded-lg border border-white/20 bg-ink-950 px-3 py-2"
      value={mode}
      disabled={disabled}
      onChange={(event) => { if (isOptionalDrawMode(event.target.value)) onChange(event.target.value) }}
    >
      <option value={OPTIONAL_DRAW_MODE.ASK}>Ask</option>
      <option value={OPTIONAL_DRAW_MODE.ACCEPT}>Always accept</option>
      <option value={OPTIONAL_DRAW_MODE.DECLINE}>Always decline</option>
    </select>
  </label>
)
