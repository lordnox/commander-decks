import { markKnownTo } from '../../knowledge'
import { manaValueOf } from '../effectRuntime'
import type Draft from '../../draft'
import type { GameObject, GameState, PlayerId, SpellCastPermission, ZoneId } from '../../types'
import { SPELL_CAST_COSTS } from './schema/v1'

type PermissionState = GameState | Draft

const permissionIsReady = (state: PermissionState, permission: SpellCastPermission) =>
  permission.remainingUses > 0
  && (permission.availableFromTurn === undefined || state.turn >= permission.availableFromTurn)

export const pendingSpellCastFor = (state: PermissionState, seat: PlayerId) =>
  (state.spellPermissions ?? []).find(permission =>
    permission.seat === seat
    && permission.cost === SPELL_CAST_COSTS.withoutPayingMana
    && permissionIsReady(state, permission))

export const pendingSpellCast = (state: PermissionState) => {
  for (const seat of state.playerOrder) {
    const permission = pendingSpellCastFor(state, seat)
    if (permission) return permission
  }
}

export const spellCastCandidates = (state: PermissionState, permission: SpellCastPermission): GameObject[] => {
  if (permission.objectId) {
    const object = state.objects[permission.objectId]
    const zone = permission.zone ?? 'exile'
    return object?.zone === zone && (permission.objectIncarnation === undefined || object.incarnation === permission.objectIncarnation) ? [object] : []
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
    && permissionIsReady(state, permission)
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
    cost?: SpellCastPermission['cost']
    asThoughFlash?: true
    grantHaste?: true
    availableFromTurn?: number
  },
) => {
  if (input.objectId && !draft.objects[input.objectId]) return
  const cost = input.cost ?? SPELL_CAST_COSTS.withoutPayingMana
  const asThoughFlash = input.asThoughFlash
  const permission: SpellCastPermission = {
    id: draft.allocId('cast'),
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    seat: input.seat,
    cost,
    remainingUses: 1,
    ...(input.grantHaste ? { grantHaste: true as const } : {}),
    ...(asThoughFlash ? { asThoughFlash: true as const } : {}),
    ...(input.objectId ? { objectId: input.objectId, objectIncarnation: draft.objects[input.objectId]!.incarnation } : {}),
    ...(input.zone ? { zone: input.zone } : {}),
    ...(input.fromSeat ? { fromSeat: input.fromSeat } : {}),
    ...(input.maxManaValue !== undefined ? { maxManaValue: input.maxManaValue } : {}),
    ...(input.notLand ? { notLand: true } : {}),
    ...(input.takeControl ? { takeControl: true } : {}),
    ...(input.inspect ? { inspect: true } : {}),
    ...(input.availableFromTurn !== undefined ? { availableFromTurn: input.availableFromTurn } : {}),
  }
  if (permission.inspect) {
    const fromSeat = permission.fromSeat ?? permission.seat
    const zone = permission.zone ?? 'hand'
    markKnownTo(draft, draft.zoneOrder[fromSeat]?.[zone] ?? [], [permission.seat])
  }
  if (spellCastCandidates(draft, permission).length === 0 && permission.availableFromTurn === undefined) return
  draft.spellPermissions = [...(draft.spellPermissions ?? []), permission]
  if (permissionIsReady(draft, permission)) draft.priority = permission.seat
}

const writePermissions = (draft: Draft, permissions: SpellCastPermission[]) => {
  if (permissions.length === 0) delete draft.spellPermissions
  else draft.spellPermissions = permissions
}

export const consumeSpellCast = (draft: Draft, seat: PlayerId, objectId?: string) => {
  const current = draft.spellPermissions ?? []
  const index = current.findIndex(permission => {
    if (permission.seat !== seat || !permissionIsReady(draft, permission)) return false
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
