import { beforeEach, describe, expect, it } from 'vitest'
import { apiClient } from './client'
import { connectionsApi } from './connections'
import { stubApi, StubRequestRecord } from '@/test/api-stub'
import { githubConnection, seekPage } from '@/test/fixtures/integrations'

const PROJECT_ID = 'proj_connections_test'

function anyConnectionsRoute() {
  return {
    match: () => true,
    respond: () => ({ status: 200, body: seekPage([githubConnection('conn_1', 'GitHub Bot')]) }),
  }
}

function requestsTo(requests: StubRequestRecord[], predicate: (url: URL) => boolean): StubRequestRecord[] {
  return requests.filter((request) => predicate(new URL(request.url)))
}

describe('connectionsApi', () => {
  beforeEach(() => {
    localStorage.clear()
    apiClient.setProjectId(null)
  })

  it('targets /v1/connections, the path the backend actually registers', async () => {
    const { calls } = stubApi([anyConnectionsRoute()])

    await connectionsApi.list()

    expect(new URL(calls[0]).pathname).toBe('/api/v1/connections')
    expect(calls[0]).not.toContain('/app-connections')
  })

  it('sends projectId on the list request, which the security layer requires', async () => {
    apiClient.setProjectId(PROJECT_ID)
    const { calls } = stubApi([anyConnectionsRoute()])

    await connectionsApi.list({ pieceName: 'github' })

    const url = new URL(calls[0])
    expect(url.searchParams.get('projectId')).toBe(PROJECT_ID)
    expect(url.searchParams.get('pieceName')).toBe('github')
  })

  it('prefers an explicit projectId over the stored one', async () => {
    apiClient.setProjectId('proj_stale')
    const { calls } = stubApi([anyConnectionsRoute()])

    await connectionsApi.list({ projectId: PROJECT_ID })

    expect(new URL(calls[0]).searchParams.get('projectId')).toBe(PROJECT_ID)
  })

  it('sends projectId in the create body, which the BODY resource extractor reads', async () => {
    apiClient.setProjectId(PROJECT_ID)
    const { requests } = stubApi([anyConnectionsRoute()])

    await connectionsApi.create({
      displayName: 'GitHub Bot',
      pieceName: 'github',
      pieceVersion: '0.1.0',
      type: 'SECRET_TEXT',
      externalId: 'ext_1',
      value: { type: 'SECRET_TEXT', secret_text: 'super-secret' },
    })

    const created = requestsTo(requests, (url) => url.pathname === '/api/v1/connections')[0]
    expect(created.method).toBe('POST')
    expect(created.body).toMatchObject({ projectId: PROJECT_ID, externalId: 'ext_1' })
    // Secrets travel in the body only, never the query string.
    expect(created.url).not.toContain('super-secret')
  })

  it('fails loudly instead of firing a project-less create when no project is resolved (#543)', async () => {
    apiClient.setProjectId(null)
    const { calls } = stubApi([anyConnectionsRoute()])

    await expect(
      connectionsApi.create({
        displayName: 'GitHub Bot',
        pieceName: 'github',
        pieceVersion: '0.1.0',
        type: 'SECRET_TEXT',
        externalId: 'ext_1',
        value: { type: 'SECRET_TEXT', secret_text: 'super-secret' },
      }),
    ).rejects.toThrow(/project/i)

    // The doomed request never fires — the backend rejects project-less writes
    // with an opaque 400 the dialog cannot explain (#543).
    expect(calls).toHaveLength(0)
  })

  it('still creates when an explicit projectId is supplied even if none is stored (#543)', async () => {
    apiClient.setProjectId(null)
    const { requests } = stubApi([anyConnectionsRoute()])

    await connectionsApi.create({
      projectId: PROJECT_ID,
      displayName: 'GitHub Bot',
      pieceName: 'github',
      pieceVersion: '0.1.0',
      type: 'SECRET_TEXT',
      externalId: 'ext_1',
      value: { type: 'SECRET_TEXT', secret_text: 'super-secret' },
    })

    const created = requestsTo(requests, (url) => url.pathname === '/api/v1/connections')[0]
    expect(created.body).toMatchObject({ projectId: PROJECT_ID })
  })

  it('reads and deletes a single connection without asserting project ownership', async () => {
    apiClient.setProjectId(PROJECT_ID)
    const { calls } = stubApi([{ match: () => true, respond: () => ({ status: 200, body: githubConnection('conn_1', 'GitHub Bot') }) }])

    await connectionsApi.get({ id: 'conn_1' })

    const url = new URL(calls[0])
    expect(url.pathname).toBe('/api/v1/connections/conn_1')
    expect(url.searchParams.has('projectId')).toBe(false)
  })

  it('builds the OAuth2 authorization URL from the registered connections path', async () => {
    const { calls } = stubApi([
      { match: () => true, respond: () => ({ status: 200, body: { authorizationUrl: 'https://example.com' } }) },
    ])

    await connectionsApi.oauth2AuthorizationUrl({
      pieceName: 'github',
      clientId: 'client-1',
      redirectUrl: 'https://app.example.com/redirect',
    })

    expect(new URL(calls[0]).pathname).toBe('/api/v1/connections/oauth2/authorization-url')
  })
})
