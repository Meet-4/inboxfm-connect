import { act } from 'react'
import { Location as RouterLocation, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IntegrationDetailPage from './detail'
import { createTestQueryClient, mount, waitFor } from '@/test/test-utils'
import { stubApi, StubRoute } from '@/test/api-stub'
import { githubConnection, githubMetadata, seekPage } from '@/test/fixtures/integrations'
import { apiClient } from '@/lib/api/client'

let lastLocation: RouterLocation | null = null

function currentLocation(): RouterLocation | null {
  return lastLocation
}

function LocationProbe() {
  const location = useLocation()
  lastLocation = location
  return null
}

function detailRoutes(options: { detailStatus?: number } = {}): StubRoute[] {
  return [
    {
      match: (url) => url.pathname === '/api/v1/connections',
      respond: (url) => {
        if (url.searchParams.get('pieceName') === 'github') {
          return {
            status: 200,
            body: seekPage([githubConnection('conn_1', 'Mihir GitHub'), githubConnection('conn_2', 'GitHub Bot')]),
          }
        }
        return { status: 200, body: seekPage([]) }
      },
    },
    {
      match: (url) => /^\/api\/v1\/integrations\/[^/]+$/.test(url.pathname),
      respond: (url) => {
        const name = url.pathname.split('/').pop() ?? ''
        if (options.detailStatus) {
          return { status: options.detailStatus, body: { message: 'error' } }
        }
        if (name === 'github') {
          return { status: 200, body: githubMetadata() }
        }
        return { status: 404, body: { message: `Piece ${name} not found` } }
      },
    },
  ]
}

function renderDetail(name = 'github'): HTMLElement {
  lastLocation = null
  const queryClient = createTestQueryClient()
  return mount(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/integrations/${name}`]}>
        <Routes>
          <Route path="/integrations" element={<div>catalog</div>} />
          <Route
            path="/integrations/:name"
            element={
              <>
                <IntegrationDetailPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

async function clickTab(container: HTMLElement, label: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (candidate) => candidate.textContent?.includes(label)
  )
  expect(tab).not.toBeUndefined()
  await act(async () => {
    tab?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    )
  })
}

describe('Integration detail', () => {
  beforeEach(() => {
    localStorage.clear()
    // The page's connections list is project-scoped and held until a project
    // resolves (#543) — model the signed-in state.
    apiClient.setProjectId('proj_default')
    document.body.innerHTML = ''
  })

  it('loads the integration and renders the overview header', async () => {
    stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Developer collaboration') === true)

    const text = container.textContent || ''
    expect(text).toContain('GitHub')
    expect(text).toContain('v0.3.4')
    expect(text).toContain('OAuth 2.0')
    expect(text).toContain('Summary')
    expect(text).toContain('Authentication')

    const connectLink = Array.from(container.querySelectorAll('a')).find(
      (link) => link.textContent?.trim() === 'Connect'
    )
    expect(connectLink).toBeDefined()
    expect(connectLink?.getAttribute('href')).toBe('/connections/new?pieceName=github')

    const overviewHeading = Array.from(container.querySelectorAll('h1')).find(
      (heading) => heading.textContent === 'GitHub'
    )
    expect(overviewHeading).toBeDefined()
  }, 15000)

  it('renders every action from the metadata in the actions tab', async () => {
    stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Actions')

    await waitFor(() => container.textContent?.includes('Create Issue') === true)

    const text = document.body.textContent || ''
    expect(text).toContain('createIssue')
    expect(text).toContain('Create a GitHub issue in a repository.')
    expect(text).toContain('List Issues')
    expect(text).toContain('listIssues')
    expect(text).toContain('2 inputs')
    expect(text).toContain('No auth')

    const actionLink = Array.from(container.querySelectorAll('a')).find((link) =>
      link.getAttribute('href')?.includes('/actions/github/createIssue')
    )
    expect(actionLink).toBeDefined()
  }, 15000)

  it('filters actions with the local search box without new network requests', async () => {
    const { calls } = stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Actions')
    await waitFor(() => container.textContent?.includes('Create Issue') === true)

    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]')
    expect(searchInput).not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(searchInput, 'create')
      searchInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const listIssuesLink = Array.from(container.querySelectorAll('a')).find((link) =>
      link.getAttribute('href')?.includes('/actions/github/listIssues')
    )
    expect(listIssuesLink).toBeUndefined()
    expect(container.textContent).toContain('Create Issue')
    expect(calls.filter((call) => call.includes('/integrations/github')).length).toBe(1)
  }, 15000)

  it('renders triggers with their delivery type', async () => {
    stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Triggers')

    await waitFor(() => container.textContent?.includes('New Issue') === true)

    const text = document.body.textContent || ''
    expect(text).toContain('newIssue')
    expect(text).toContain('Polling')
    expect(text).toContain('Push Event')
    expect(text).toContain('Webhook')
    expect(text).toContain('onPush')
  }, 15000)

  it('queries connections filtered by piece name in the connections tab', async () => {
    const { calls } = stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Connections')

    await waitFor(() => container.textContent?.includes('Mihir GitHub') === true, 4000)

    expect(calls.some((call) => call.includes('/connections?pieceName=github'))).toBe(true)
    const text = document.body.textContent || ''
    expect(text).toContain('GitHub Bot')
    expect(text).toContain('Connected')
  }, 15000)

  it('links connection rows to their detail page and offers reconnect', async () => {
    stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Connections')

    await waitFor(() => container.textContent?.includes('Mihir GitHub') === true, 4000)

    const rowLink = Array.from(container.querySelectorAll('a')).find(
      (link) => link.getAttribute('href') === '/connections/conn_1'
    )
    expect(rowLink).toBeDefined()

    const reconnectLink = Array.from(container.querySelectorAll('a')).find(
      (link) =>
        link.getAttribute('href')?.includes('/connections/new?pieceName=github&externalId=')
    )
    expect(reconnectLink).toBeDefined()
  }, 15000)

  it('reflects newly created connections after query invalidation without a reload', async () => {
    let listEmpty = true
    global.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/v1/connections') {
        return new Response(
          JSON.stringify(
            listEmpty
              ? { data: [], next: null, previous: null }
              : {
                  data: [githubConnection('conn_new', 'Freshly Connected')],
                  next: null,
                  previous: null,
                }
          ),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (/^\/api\/v1\/integrations\/[^/]+$/.test(url.pathname)) {
        return new Response(JSON.stringify(githubMetadata()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ message: 'unhandled' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })

    lastLocation = null
    const queryClient = createTestQueryClient()
    const container = mount(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/integrations/github?tab=connections']}>
          <Routes>
            <Route
              path="/integrations/:name"
              element={
                <>
                  <IntegrationDetailPage />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    await waitFor(() => container.textContent?.includes('No GitHub connections yet.') === true, 4000)

    // A connection is created elsewhere; invalidation must surface it without any navigation.
    const locationBeforeInvalidation = `${currentLocation()?.pathname}${currentLocation()?.search}`
    listEmpty = false
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['connections'] })
    })

    await waitFor(() => container.textContent?.includes('Freshly Connected') === true, 4000)
    expect(`${currentLocation()?.pathname}${currentLocation()?.search}`).toBe(
      locationBeforeInvalidation
    )
    const statusBadge = document.body.textContent || ''
    expect(statusBadge).toContain('Connected')
  }, 15000)

  it('shows the not-found state with a back link for unknown integrations', async () => {
    stubApi(detailRoutes())
    const container = renderDetail('ghost-piece')

    await waitFor(() => container.textContent?.includes('Integration not found') === true, 4000)

    const backLink = Array.from(container.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Back to Integrations')
    )
    expect(backLink).not.toBeUndefined()
    expect(backLink?.getAttribute('href')).toBe('/integrations')
  }, 15000)

  it('keeps the active tab in the URL for deep linking', async () => {
    stubApi(detailRoutes())
    const container = renderDetail()

    await waitFor(() => container.textContent?.includes('Summary') === true)
    await clickTab(container, 'Triggers')

    await waitFor(() => lastLocation?.search.includes('tab=triggers') === true)

    const triggersTab = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) =>
      tab.textContent?.includes('Triggers')
    )
    expect(triggersTab?.getAttribute('aria-selected')).toBe('true')
  }, 15000)
})
