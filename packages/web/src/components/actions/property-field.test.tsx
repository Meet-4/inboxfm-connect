import { describe, expect, it, vi } from 'vitest'
import { PropertyField } from './property-field'
import { PieceProperty } from '@/lib/api/types'
import { mount } from '@/test/test-utils'

const jsonProp: PieceProperty = { displayName: 'Filter', required: true, type: 'JSON' }

const longTextProp: PieceProperty = {
  displayName: 'Message body',
  required: true,
  type: 'LONG_TEXT',
}

const dateTimeProp: PieceProperty = {
  displayName: 'Start time',
  required: false,
  type: 'DATE_TIME',
}

function renderField(value: unknown, property: PieceProperty = jsonProp): HTMLElement {
  return mount(
    <PropertyField
      pieceName="github"
      pieceVersion="0.3.4"
      actionOrTriggerName="createIssue"
      name="filter"
      property={property}
      value={value}
      onChange={() => undefined}
      getInput={() => ({})}
    />
  )
}

describe('PropertyField JSON/OBJECT rendering', () => {
  it('renders a stored parsed JSON value as editable JSON text', () => {
    const container = renderField({ state: 'open' })
    const textarea = container.querySelector('textarea')
    expect(textarea?.value).toBe('{\n  "state": "open"\n}')
  })

  it('renders string values unchanged', () => {
    const container = renderField('{"raw":true}')
    const textarea = container.querySelector('textarea')
    expect(textarea?.value).toBe('{"raw":true}')
  })

  it('renders an empty value as an empty textarea', () => {
    const container = renderField('')
    const textarea = container.querySelector('textarea')
    expect(textarea?.value).toBe('')
  })
})

describe('PropertyField LONG_TEXT rendering', () => {
  it('renders a textarea instead of dropping the field', () => {
    const container = renderField('line one\nline two', longTextProp)
    const control = container.querySelector('textarea')
    expect(control).not.toBeNull()
    expect(container.querySelector('[data-testid="unsupported-prop-filter"]')).toBeNull()
    expect(container.textContent).toContain('Message body')
  })

  it('round-trips the raw text without trimming it', () => {
    const onChange = vi.fn()
    const container = mount(
      <PropertyField
        pieceName="github"
        pieceVersion="0.3.4"
        actionOrTriggerName="createIssue"
        name="filter"
        property={longTextProp}
        value=""
        onChange={onChange}
        getInput={() => ({})}
      />
    )
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    setter?.call(textarea, '  padded body\n')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith('  padded body\n')
  })

  it('renders an empty LONG_TEXT as an empty textarea', () => {
    const container = renderField('', longTextProp)
    expect(container.querySelector('textarea')?.value).toBe('')
  })
})
