type AllocationBound = { total: number; minEach: number }

export const allocationOptions = (
  allocationIndex: number,
  recipientCount: number,
  bound: AllocationBound,
  chosenTotal = 0,
) => {
  const remaining = recipientCount - allocationIndex - 1
  const min = bound.minEach
  const max = bound.total - chosenTotal - min * Math.max(0, remaining)
  if (allocationIndex === recipientCount - 1) {
    return [{ id: `allocation:${allocationIndex}:${max}`, label: String(max) }]
  }
  if (!Number.isSafeInteger(max) || max < min || max - min > 256) return []
  return Array.from(
    { length: max - min + 1 },
    (_value, index) => ({ id: `allocation:${allocationIndex}:${min + index}`, label: String(min + index) }),
  )
}
