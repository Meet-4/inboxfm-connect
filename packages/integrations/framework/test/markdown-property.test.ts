import { MarkdownVariant } from '@inboxfm-connect/core-piece-types'
import { describe, expect, it } from 'vitest'
import { MarkDownProperty } from '../src/lib/property/input/markdown-property'
import { Property } from '../src/lib/property/input'
import { PropertyType } from '../src/lib/property/input/property-type'

// Property.MarkDown() always emits `variant` (default INFO) and the TS type
// declares it — the zod schema must validate and retain the field on parse,
// not silently strip it.
describe('MarkDownProperty zod schema', () => {
    it('retains the default variant Property.MarkDown always emits', () => {
        const emitted = Property.MarkDown({ value: '# Step docs' })

        expect(emitted.variant).toBe(MarkdownVariant.INFO)

        const parsed = MarkDownProperty.parse(emitted)
        expect(parsed.variant).toBe(MarkdownVariant.INFO)
    })

    it('retains an explicitly chosen variant', () => {
        const emitted = Property.MarkDown({ value: '**Careful**', variant: MarkdownVariant.WARNING })

        const parsed = MarkDownProperty.parse(emitted)

        expect(parsed.variant).toBe(MarkdownVariant.WARNING)
    })

    it('still parses markdown properties that predate the variant field', () => {
        const parsed = MarkDownProperty.parse({
            displayName: 'Markdown',
            description: '# Legacy metadata without a variant',
            required: false,
            type: PropertyType.MARKDOWN,
        })

        expect(parsed.variant).toBeUndefined()
    })
})
