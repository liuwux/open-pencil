import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { HeadlessDocumentSession } from '#mcp/headless/session'

describe('headless document session', () => {
  test('decodes once across sequential commands', async () => {
    const graph = new SceneGraph()
    let loads = 0
    const session = new HeadlessDocumentSession('/unused.fig', async () => {
      loads++
      return graph
    })

    await session.execute('pages', {})
    await session.execute('pages', {})

    expect(loads).toBe(1)
    expect(session.status()).toMatchObject({ state: 'ready', loadCount: 1 })
  })

  test('shares one decode across concurrent first commands', async () => {
    const graph = new SceneGraph()
    let loads = 0
    const session = new HeadlessDocumentSession('/unused.fig', async () => {
      loads++
      await Promise.resolve()
      return graph
    })

    await Promise.all([session.execute('pages', {}), session.execute('pages', {})])

    expect(loads).toBe(1)
    expect(session.status()).toMatchObject({ state: 'ready', loadCount: 1 })
  })
})
