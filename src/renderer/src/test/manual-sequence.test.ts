import { expect, it } from 'vitest'
import { groupAddressSteps, type ManualStep } from './manual-sequence'

const step = (id: string, start: number, universe = 100, rep: number | null = 0): ManualStep => ({
  fixture: { id, shapeId: id, mode: 'rgb', start, universe }, start, universe, rep,
  targets: [rep == null ? id : `${id}:${rep}`]
})

it('advances linked lines together, then moves to the next RGB address', () => {
  const items = [step('a', 1), step('b', 1), step('c', 4), step('d', 4)]
  const before = JSON.stringify(items)
  const groups = groupAddressSteps(items)
  expect(groups.map((s) => s.targets)).toEqual([['a:0', 'b:0'], ['c:0', 'd:0']])
  expect(groups.map((s) => s.start)).toEqual([1, 4])
  expect(JSON.stringify(items)).toBe(before)
})

it('keeps universe and channel mode boundaries separate', () => {
  const dim = step('dimmer', 1)
  dim.fixture.mode = 'dim'
  expect(groupAddressSteps([step('a', 1), step('b', 1, 101), dim])).toHaveLength(3)
})

it('links repeated cells sharing one address and deduplicates manual targets', () => {
  const a = step('array', 1, 100, 0)
  const b = step('array', 1, 100, 1)
  expect(groupAddressSteps([a, b, a])[0].targets).toEqual(['array:0', 'array:1'])
})
