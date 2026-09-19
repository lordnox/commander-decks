/**
 * The live host's kernel surface. Callers import from here; the work lives in
 * one module per job: opening the journal, settling priority, applying acts,
 * and preparing or applying a pending choice.
 */
export { kernelActions, kernelPriority, type KernelHandle } from './kernelHandle'
export {
  assertAgentKernelBoundary,
  hasKernel,
  kernelPath,
  loadHostCardPlugins,
  openKernel,
  rollbackState,
} from './kernelOpen'
export { prepareKernelPendingChoice } from './kernelChoicePrepare'
export { settleKernelHolds, settleKernelPriority } from './kernelSettle'
export { applyKernelChoice } from './kernelChoiceApply'
export { applyKernelAct, applyKernelAdvance } from './kernelActs'
export {
  encodeKernelSnapshot,
  historyForViewer,
  publishKernel,
} from './kernelPublish'
