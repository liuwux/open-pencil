import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createExportTextMeasurementCache,
  importedFigTextMeasurement
} from '#core/canvas/renderer/fonts'

describe('export text measurement cache', () => {
  test('reuses a node measurement for the same rounded width constraint', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, { text: 'cache me' })
    let measurements = 0
    const cache = createExportTextMeasurementCache((_node, maxWidth) => {
      measurements += 1
      return { width: maxWidth ?? 80, height: 20 }
    })

    expect(cache.measure(text, 100.2)).toEqual({ width: 100.2, height: 20 })
    expect(cache.measure(text, 100.4)).toEqual({ width: 100.2, height: 20 })
    expect(cache.measure(text, 100.6)).toEqual({ width: 100.6, height: 20 })
    expect(cache.measure(text)).toEqual({ width: 80, height: 20 })
    expect(measurements).toBe(3)
    expect(cache.stats()).toEqual({
      text_measure_calls: 4,
      text_measure_cache_hits: 1,
      text_measure_cache_misses: 3
    })
  })

  test('caches unavailable measurements and releases entries on clear', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, { text: 'missing font' })
    let measurements = 0
    const cache = createExportTextMeasurementCache(() => {
      measurements += 1
      return null
    })

    expect(cache.measure(text, 120)).toBeNull()
    expect(cache.measure(text, 120)).toBeNull()
    cache.clear()
    expect(cache.measure(text, 120)).toBeNull()
    expect(measurements).toBe(2)
  })

  test('uses stored geometry for imported fig text', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, { text: 'imported' })

    expect(importedFigTextMeasurement(text)).toBeUndefined()
    graph.updateNode(text.id, {
      figmaDerivedLayout: { width: 35, height: 17 },
      source: { ...text.source, format: 'fig' }
    })

    expect(importedFigTextMeasurement(text)).toEqual({ width: 35, height: 17 })
  })
})
