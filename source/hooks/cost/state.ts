import type { CostSurfaceSnapshot } from '../../types'

let snapshot: CostSurfaceSnapshot | undefined
export function costSnapshot(): CostSurfaceSnapshot | undefined { return snapshot }
export function setCostSnapshot(value: CostSurfaceSnapshot | undefined): void { snapshot = value }
