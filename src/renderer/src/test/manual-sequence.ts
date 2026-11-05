import type { Fixture } from '../model/types'

export type ManualStep = {
  fixture: Fixture
  rep: number | null
  universe: number
  start: number
  targets: string[]
}

/** One DMX address is one step, including every linked shape at that address. */
export function groupAddressSteps(items: ManualStep[]): ManualStep[] {
  const groups = new Map<string, ManualStep>()
  for (const item of items) {
    const key = `${item.universe}:${item.start}:${item.fixture.mode}`
    const previous = groups.get(key)
    if (previous) previous.targets = [...new Set([...previous.targets, ...item.targets])]
    else groups.set(key, { ...item, targets: [...item.targets] })
  }
  return [...groups.values()]
}
