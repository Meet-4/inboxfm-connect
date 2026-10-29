import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework'
import { PropertyExecutionType } from '@inboxfm-connect/shared'
import type { PropertySettings } from '@inboxfm-connect/shared'
import { propsProcessor } from '../../src/lib/variables/props-processor'

// A property value of the wrong shape must never be rewritten into a fabricated value:
// the piece then acts on data the user never supplied and the run looks successful.
const arrayProp = Property.Array({
    displayName: 'Documents',
    required: true,
    properties: {
        file: Property.ShortText({ displayName: 'File', required: true }),
    },
})

const dynamicProp = Property.DynamicProperties({
    auth: undefined,
    displayName: 'Dynamic',
    required: true,
    refreshers: [],
    props: async () => ({}),
})

const dynamicSettings: Record<string, PropertySettings> = {
    dynamic: {
        type: PropertyExecutionType.MANUAL,
        schema: {
            field: Property.ShortText({ displayName: 'Field', required: true }),
        },
    },
}

describe('propsProcessor wrong-shaped values', () => {
    it('leaves a non-array value for an array property untouched so validation reports it', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { documents: 'not-an-array' },
            { documents: arrayProp },
            PieceAuth.None(),
            false,
            {},
        )

        expect(processedInput.documents).toBe('not-an-array')
        expect(errors).toEqual({
            documents: ['Expected array, received: not-an-array'],
        })
    })

    it('keeps array items that are not objects instead of collapsing them into empty objects', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { documents: [1, 2] },
            { documents: arrayProp },
            PieceAuth.None(),
            false,
            {},
        )

        expect(processedInput.documents).toEqual([1, 2])
        expect(errors).toEqual({})
    })

    it('still zips the builder shape (an object of per-field arrays)', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { documents: { file: ['a', 'b'] } },
            { documents: arrayProp },
            PieceAuth.None(),
            false,
            {},
        )

        expect(processedInput.documents).toEqual([{ file: 'a' }, { file: 'b' }])
        expect(errors).toEqual({})
    })

    it('leaves a non-object dynamic value untouched instead of spreading it into a keyed object', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { dynamic: 'oops' },
            { dynamic: dynamicProp },
            PieceAuth.None(),
            false,
            dynamicSettings,
        )

        expect(processedInput.dynamic).toBe('oops')
        expect(errors).toEqual({})
    })

    it('still processes an object dynamic value', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { dynamic: { field: 'value' } },
            { dynamic: dynamicProp },
            PieceAuth.None(),
            false,
            dynamicSettings,
        )

        expect(processedInput.dynamic).toEqual({ field: 'value' })
        expect(errors).toEqual({})
    })

    it('does not crash on a null dynamic value', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { dynamic: null },
            { dynamic: dynamicProp },
            PieceAuth.None(),
            false,
            dynamicSettings,
        )

        expect(processedInput.dynamic).toBeNull()
        expect(errors).toEqual({})
    })
})
