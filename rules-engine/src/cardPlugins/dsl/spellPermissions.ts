import { markKnownTo } from '../../knowledge'
import { manaValueOf } from '../effectRuntime'
import type Draft from '../../draft'
import type { GameObject, GameState, PlayerId, SpellCastPermission, ZoneId } from '../../types'
import { SPELL_CAST_COSTS } from './schema/v1'

type PermissionState = GameState | Draft

export const pendingSpellCastFor = (state: PermissionState, seat: PlayerId) =>
  (state.spellPermissions ?? []).find(permission => permission.seat === seat && permission.remainingUses > 0)

export const pendingSpellCast = (state: PermissionState) => {
  for (const seat of state.playerOrder) {
    const permission = pendingSpellCastFor(state, seat)
    if (permission) return permission
  }
}

export const spellCastCandidates = (state: PermissionState, permission: SpellCastPermission): GameObject[] => {
  if (permission.objectId) {
    const object = state.objects[permission.objectId]
    return object?.zone === 'exile' ? [object] : []
  }
  const fromSeat = permission.fromSeat ?? permission.seat
  const zone = permission.zone ?? 'hand'
  return (state.zoneOrder[fromSeat]?.[zone] ?? [])
    .map(objectId => state.objects[objectId])
    .filter((object): object is GameObject => Boolean(object))
    .filter(object => {
      if (permission.notLand && object.types.includes('Land')) return false
      if (permission.maxManaValue !== undefined && manaValueOf(object) > permission.maxManaValue) return false
      return true
    })
}

export const matchingSpellCast = (state: PermissionState, seat: PlayerId, objectId: string) =>
  (state.spellPermissions ?? []).find(permission =>
    permission.seat === seat
    && permission.remainingUses > 0
    && spellCastCandidates(state, permission).some(candidate => candidate.id === objectId))

export const openSpellCast = (
  draft: Draft,
  input: {
    sourceId: string
    sourceName: string
    seat: PlayerId
    objectId?: string
    zone?: ZoneId
    fromSeat?: PlayerId
    maxManaValue?: number
    notLand?: true
    takeControl?: true
    inspect?: true
  },
) => {
  const permission: SpellCastPermission = {
    id: draft.allocId('cast'),
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    seat: input.seat,
    cost: SPELL_CAST_COSTS.withoutPayingMana,
    asThoughFlash: true,
    remainingUses: 1,
    ...(input.objectId ? { objectId: input.objectId } : {}),
    ...(input.zone ? { zone: input.zone } : {}),
    ...(input.fromSeat ? { fromSeat: input.fromSeat } : {}),
    ...(input.maxManaValue !== undefined ? { maxManaValue: input.maxManaValue } : {}),
    ...(input.notLand ? { notLand: true } : {}),
    ...(input.takeControl ? { takeControl: true } : {}),
    ...(input.inspect ? { inspect: true } : {}),
  }
  if (permission.inspect) {
    const fromSeat = permission.fromSeat ?? permission.seat
    const zone = permission.zone ?? 'hand'
    markKnownTo(draft, draft.zoneOrder[fromSeat]?.[zone] ?? [], [permission.seat])
  }
  if (spellCastCandidates(draft, permission).length === 0) return
  draft.spellPermissions = [...(draft.spellPermissions ?? []), permission]
  draft.priority = permission.seat
}

const writePermissions = (draft: Draft, permissions: SpellCastPermission[]) => {
  if (permissions.length === 0) delete draft.spellPermissions
  else draft.spellPermissions = permissions
}

export const consumeSpellCast = (draft: Draft, seat: PlayerId, objectId?: string) => {
  const current = draft.spellPermissions ?? []
  const index = current.findIndex(permission => {
    if (permission.seat !== seat || permission.remainingUses <= 0) return false
    if (objectId === undefined) return true
    if (permission.sourceId === objectId || permission.objectId === objectId) return true
    return permission.zone !== undefined
  })
  if (index < 0) return
  const remaining = current[index]!.remainingUses - 1
  const next = remaining > 0
    ? current.map((permission, permissionIndex) =>
      permissionIndex === index ? { ...permission, remainingUses: remaining } : permission)
    : current.filter((_, permissionIndex) => permissionIndex !== index)
  writePermissions(draft, next)
}
