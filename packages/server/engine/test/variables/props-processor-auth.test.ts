import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework'
import { AppConnectionType } from '@inboxfm-connect/shared'
import { propsProcessor } from '../../src/lib/variables/props-processor'

// V1+ pieces get the connection value wrapped as `{ type, props }`; V0 pieces get the
// bare props object. Both shapes carry the same auth fields, so both must be processed
// and validated identically — otherwise every wrapped custom-auth connection hands the
// piece strings for number/JSON/date fields and never reports a missing required field.
const customAuth = PieceAuth.CustomAuth({
    displayName: 'Custom',
    required: true,
    props: {
        accountId: Property.Number({ displayName: 'Account ID', required: true }),
        settings: Property.Json({ displayName: 'Settings', required: false }),
        apiKey: Property.ShortText({ displayName: 'API Key', required: true }),
    },
})

describe('propsProcessor auth values', () => {
    it('processes auth fields of a V0 (bare props) connection value', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { auth: { accountId: '12', settings: '{"team":"a"}', apiKey: 'key' } },
            {},
            customAuth,
            true,
            {},
        )

        expect(processedInput.auth).toEqual({ accountId: 12, settings: { team: 'a' }, apiKey: 'key' })
        expect(errors).toEqual({})
    })

    it('processes auth fields of a wrapped (V1) connection value and keeps the envelope', async () => {
        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            { auth: { type: AppConnectionType.CUSTOM_AUTH, props: { accountId: '12', settings: '{"team":"a"}', apiKey: 'key' } } },
            {},
            customAuth,
            true,
            {},
        )

        expect(processedInput.auth).toEqual({
            type: AppConnectionType.CUSTOM_AUTH,
            props: { accountId: 12, settings: { team: 'a' }, apiKey: 'key' },
        })
        expect(errors).toEqual({})
    })

    it('keeps OAuth2 connection metadata when processing the nested auth props', async () => {
        const oauth2Auth = PieceAuth.OAuth2({
            displayName: 'OAuth2',
            required: true,
            authUrl: 'https://example.com/auth',
            tokenUrl: 'https://example.com/token',
            scope: [],
            props: {
                region: Property.ShortText({ displayName: 'Region', required: false }),
            },
        })

        const { processedInput, errors } = await propsProcessor.applyProcessorsAndValidators(
            {
                auth: {
                    type: AppConnectionType.OAUTH2,
                    access_token: 'access-token',
                    refresh_token: 'refresh-token',
                    props: { region: 'eu' },
                },
            },
            {},
            oauth2Auth,
            true,
            {},
        )

        expect(processedInput.auth).toEqual({
            type: AppConnectionType.OAUTH2,
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            props: { region: 'eu' },
        })
        expect(errors).toEqual({})
    })

    it('reports invalid wrapped auth fields instead of handing them to the piece', async () => {
        const { errors } = await propsProcessor.applyProcessorsAndValidators(
            { auth: { type: AppConnectionType.CUSTOM_AUTH, props: { accountId: 'not-a-number', apiKey: 'key' } } },
            {},
            customAuth,
            true,
            {},
        )

        expect(errors).toEqual({
            auth: {
                accountId: ['Expected number, received: not-a-number'],
            },
        })
    })

    it('reports a null required wrapped auth field', async () => {
        const { errors } = await propsProcessor.applyProcessorsAndValidators(
            { auth: { type: AppConnectionType.CUSTOM_AUTH, props: { accountId: null, apiKey: 'key' } } },
            {},
            customAuth,
            true,
            {},
        )

        expect(errors).toEqual({
            auth: {
                accountId: ['Expected number, received: null'],
            },
        })
    })
})
