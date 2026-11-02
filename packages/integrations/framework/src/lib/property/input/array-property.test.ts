import { describe, it, expect } from 'vitest'
import { Property } from './index'
import { ArrayProperty } from './array-property'
import { ToolBase } from '../../piece-metadata'

describe('ArrayProperty schema & factory validation (issue #629)', () => {
  it('validates Property.Array factory output when properties is omitted', () => {
    const prop = Property.Array({
      displayName: 'Recipients',
      description: 'List of email recipients',
      required: true,
    })

    const parsed = ArrayProperty.safeParse(prop)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.displayName).toBe('Recipients')
      expect(parsed.data.type).toBe('ARRAY')
      expect(parsed.data.required).toBe(true)
      expect(parsed.data.properties).toBeUndefined()
    }
  })

  it('validates Property.Array factory output when properties is provided', () => {
    const prop = Property.Array({
      displayName: 'Tags',
      required: false,
      properties: {
        tag: Property.ShortText({
          displayName: 'Tag Name',
          required: true,
        }),
        color: Property.Color({
          displayName: 'Tag Color',
          required: false,
        }),
        metadata: Property.Json({
          displayName: 'Tag Metadata',
          required: false,
        }),
      },
    })

    const parsed = ArrayProperty.safeParse(prop)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.displayName).toBe('Tags')
      expect(parsed.data.required).toBe(false)
      expect(parsed.data.properties).toBeDefined()
      expect(parsed.data.properties?.tag).toBeDefined()
      expect(parsed.data.properties?.color).toBeDefined()
      expect(parsed.data.properties?.metadata).toBeDefined()
    }
  })

  it('validates serialized JSON catalog item through ToolBase', () => {
    const action = {
      name: 'send_email',
      displayName: 'Send Email',
      description: 'Sends an email to recipients',
      requireAuth: false,
      props: {
        to: Property.Array({
          displayName: 'To',
          description: 'Recipient email addresses',
          required: true,
        }),
        subject: Property.ShortText({
          displayName: 'Subject',
          required: true,
        }),
      },
    }

    // Direct runtime validation
    const runtimeResult = ToolBase.safeParse(action)
    expect(runtimeResult.success).toBe(true)

    // Serialized JSON validation (catalog storage / MCP tools)
    const serialized = JSON.parse(JSON.stringify(action))
    const serializedResult = ToolBase.safeParse(serialized)
    expect(serializedResult.success).toBe(true)
  })

  // Issue #629 follow-up: the catalog must store real ARRAY item schemas for
  // EVERY type a piece can legally declare inside `properties` (ArraySubProps
  // union), not just text-like placeholders. The factory carries the declared
  // item `properties` through (they are serializable records), the zod union
  // accepts all of them, and a JSON round-trip must keep them intact.
  it('serializes array props with every legal item type through ToolBase (issue #629)', () => {
    const itemProperties = {
      shortText: Property.ShortText({ displayName: 'Short Text', required: true }),
      longText: Property.LongText({ displayName: 'Long Text', required: false }),
      staticDropdown: Property.StaticDropdown({
        displayName: 'Static Dropdown',
        required: false,
        options: { options: [{ label: 'Option A', value: 'a' }] },
      }),
      multiSelect: Property.MultiSelectDropdown({
        displayName: 'Multi Select',
        required: false,
        auth: false,
        refreshers: [],
        options: async () => ({ options: [{ label: 'Option B', value: 'b' }] }),
      }),
      staticMultiSelect: Property.StaticMultiSelectDropdown({
        displayName: 'Static Multi Select',
        required: false,
        options: { options: [{ label: 'Tags', value: ['x', 'y'] }] },
      }),
      checkbox: Property.Checkbox({ displayName: 'Checkbox', required: false }),
      number: Property.Number({ displayName: 'Number', required: false }),
      file: Property.File({ displayName: 'File', required: false }),
      json: Property.Json({ displayName: 'JSON', required: false }),
      color: Property.Color({ displayName: 'Color', required: false }),
      dateTime: Property.DateTime({ displayName: 'Date Time', required: false }),
    }

    const action = {
      name: 'create_records',
      displayName: 'Create Records',
      description: 'Creates records from a list of typed items',
      requireAuth: false,
      props: {
        records: Property.Array({
          displayName: 'Records',
          description: 'Records to create',
          required: true,
          properties: itemProperties,
        }),
      },
    }

    const serialized = JSON.parse(JSON.stringify(action))
    const result = ToolBase.safeParse(serialized)
    expect(result.success).toBe(true)
    if (result.success) {
      const items = result.data.props?.['records']?.properties ?? {}
      expect(Object.keys(items).sort()).toEqual(Object.keys(itemProperties).sort())
      // The honest item schema survives — no placeholder padding is involved.
      expect(items['shortText']).toMatchObject({ type: 'SHORT_TEXT', required: true })
      expect(items['json']).toMatchObject({ type: 'JSON' })
      expect(items['staticDropdown']).toMatchObject({ type: 'STATIC_DROPDOWN' })
      expect((items['staticDropdown'] as { options?: unknown }).options).toBeDefined()
    }
  })

  it('keeps bare arrays (no declared item schema) catalog-valid without padding (issue #629)', () => {
    const action = {
      name: 'send_email',
      displayName: 'Send Email',
      description: 'Sends an email',
      requireAuth: false,
      props: {
        to: Property.Array({
          displayName: 'To',
          description: 'Recipient email addresses',
          required: true,
        }),
      },
    }
    const serialized = JSON.parse(JSON.stringify(action))
    const result = ToolBase.safeParse(serialized)
    expect(result.success).toBe(true)
    if (result.success) {
      // Bare array of strings: nothing was fabricated — no invented item
      // placeholder and no valueSchema stomp.
      const to = result.data.props?.['to'] as Record<string, unknown>
      expect(to['type']).toBe('ARRAY')
      expect(to['properties']).toBeUndefined()
    }
  })
})
