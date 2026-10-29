import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditTriggerBindingPage from './triggers-edit'
import { createTestQueryClient, mount, waitFor } from '@/test/test-utils'
import { ALL_SUMMARIES, githubMetadata, seekPage } from '@/test/fixtures/integrations'
import { automationConnection, githubTriggerBinding } from '@/test/fixtures/automations'

interface RecordedRequest {
  url: string
  method: string
  body?: unknown
}

const pendingRestores: Array<() => void> = []

/**
 * Edit-mode regression coverage: the binding form renders the trigger's props plus
 * the two cron fields, but `settings` also carries keys it does not render — most
 * importantly `timezone`, which `trigger-binding.service.ts` feeds straight into
 * node-cron. Rebuilding `settings` from scratch on save dropped every such key, so
 * editing the instruction of a 09:00 Asia/Kolkata binding silently moved it to
 * 09:00 UTC (and wiped any configured prop the current piece version cannot render).
 */
function installApi(binding: ReturnType<typeof githubTriggerBinding>): RecordedRequest[] {
  const requests: RecordedRequest[] = []
  const originalFetch = global.fetch

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  async function handler(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const raw = String(input)
    const url = new URL(raw, 'http://localhost')
    const method = init?.method ?? 'GET'
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = undefined
      }
    }
    requests.push({ url: raw, method, body })

    if (url.pathname === `/api/v1/trigger-bindings/${binding.id}` && method === 'GET') {
      return json(binding)
    }
    if (url.pathname === `/api/v1/trigger-bindings/${binding.id}` && method === 'POST') {
      return json({ ...binding, ...(body as Record<string, unknown>) })
    }
    if (url.pathname === '/api/v1/integrations') {
      return json(seekPage(ALL_SUMMARIES))
    }
    if (url.pathname === '/api/v1/integrations/github') {
      return json(githubMetadata())
    }
    if (url.pathname === '/api/v1/connections') {
      return json({ data: [automationConnection()], next: null, previous: null })
    }
    return json({ message: `unhandled ${method} ${raw}` }, 404)
  }

  global.fetch = vi.fn(handler) as unknown as typeof fetch
  pendingRestores.push(() => {
    global.fetch = originalFetch
  })
  return requests
}

async function setInputValue(container: HTMLElement, selector: string, value: string): Promise<void> {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  expect(element).not.toBeNull()
  await act(async () => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
    setter?.call(element, value)
    element?.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickSubmit(container: HTMLElement): Promise<void> {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="submit-binding"]')
  expect(button).not.toBeNull()
  await act(async () => {
    button?.click()
  })
}

function renderEditForm(): HTMLElement {
  const queryClient = createTestQueryClient()
  return mount(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/automations/triggers/tb_github_push/edit']}>
        <Routes>
          <Route path="/automations/triggers/:id/edit" element={<EditTriggerBindingPage />} />
          <Route path="/automations/triggers/:id" element={<div>binding detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function submittedBody(requests: RecordedRequest[]): Record<string, unknown> | undefined {
  return requests.find(
    (request) => request.method === 'POST' && request.url.includes('/api/v1/trigger-bindings/')
  )?.body as Record<string, unknown> | undefined
}

describe('Trigger binding edit', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    while (pendingRestores.length > 0) {
      pendingRestores.pop()?.()
    }
  })

  it('keeps stored settings the form does not render (timezone) when saving', async () => {
    const binding = githubTriggerBinding({
      id: 'tb_github_push',
      triggerName: 'onPush',
      settings: { branch: 'main', cronExpression: '0 9 * * *', timezone: 'Asia/Kolkata' },
    })
    const requests = installApi(binding)
    const container = renderEditForm()

    await waitFor(() => container.querySelector('#binding-prompt') !== null)
    await waitFor(() => container.querySelector('#prop-branch') !== null)

    await setInputValue(container, '#binding-prompt', 'Announce every push to the #dev channel.')
    await clickSubmit(container)

    await waitFor(() => submittedBody(requests) !== undefined)
    expect(submittedBody(requests)?.settings).toEqual({
      branch: 'main',
      cronExpression: '0 9 * * *',
      timezone: 'Asia/Kolkata',
    })
  }, 20000)

  it('still removes a cron expression the user clears instead of resurrecting it', async () => {
    const binding = githubTriggerBinding({
      id: 'tb_github_push',
      triggerName: 'onPush',
      settings: { branch: 'main', cronExpression: '0 9 * * *', timezone: 'Asia/Kolkata' },
    })
    const requests = installApi(binding)
    const container = renderEditForm()

    await waitFor(() => container.querySelector('#binding-cron') !== null)
    await setInputValue(container, '#binding-cron', '')
    await clickSubmit(container)

    await waitFor(() => submittedBody(requests) !== undefined)
    const settings = submittedBody(requests)?.settings as Record<string, unknown>
    expect(settings.cronExpression).toBeUndefined()
    expect(settings).toEqual({ branch: 'main', timezone: 'Asia/Kolkata' })
  }, 20000)
})
