import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { assertLocalFonts, fontconfigFamilyMatches } from '#cli/system-fonts'

describe('headless system fonts', () => {
  test('accepts an exact fontconfig family match', () => {
    expect(fontconfigFamilyMatches('MiSans', 'MiSans')).toBeTrue()
    expect(
      fontconfigFamilyMatches('Noto Sans CJK SC', 'Noto Sans CJK SC, Noto Sans CJK SC Medium')
    ).toBeTrue()
  })

  test('rejects a fontconfig substitution', () => {
    expect(fontconfigFamilyMatches('MiSans', 'DejaVu Sans')).toBeFalse()
  })

  test('does not require a font when fig glyph outlines are embedded', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const text = graph.createNode('TEXT', page.id, {
      text: 'outlined',
      fontFamily: 'Definitely Missing',
      figmaDerivedTextGlyphs: [{ commandsBlob: new Uint8Array([0]), x: 0, y: 10, fontSize: 14 }]
    })

    await expect(assertLocalFonts(graph, [text.id])).resolves.toBeUndefined()
  })
})
