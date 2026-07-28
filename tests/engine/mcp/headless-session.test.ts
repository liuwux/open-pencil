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

  test('executes the full tool registry against the cached graph', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const rectangle = graph.createNode('RECTANGLE', page.id, {
      name: 'Export me',
      width: 40,
      height: 20,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const session = new HeadlessDocumentSession('/unused.fig', async () => graph)

    const evaluated = await session.rpc({
      command: 'tool',
      args: { name: 'eval', args: { code: 'return figma.currentPage.name' } }
    })
    const exported = await session.rpc({
      command: 'tool',
      args: { name: 'export_svg', args: { ids: [rectangle.id] } }
    })

    expect(evaluated).toEqual({ ok: true, result: 'Page 1' })
    expect(exported).toMatchObject({ ok: true, result: { svg: expect.stringContaining('<svg') } })
    expect(session.status()).toMatchObject({ state: 'ready', loadCount: 1 })
  })
})
