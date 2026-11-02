import { Building2, FolderKey, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiKeyRow, ApiKeysTable } from '@/components/api-keys/api-keys-table'
import { CreateApiKeyDialog } from '@/components/api-keys/create-api-key-dialog'
import { RevealApiKeyDialog, RevealedApiKey } from '@/components/api-keys/reveal-api-key-dialog'
import { RevokeApiKeyDialog } from '@/components/api-keys/revoke-api-key-dialog'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { PlatformApiKeyWithValue, ProjectApiKeyWithValue } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/auth-context'
import {
  useCreatePlatformApiKey,
  useCreateProjectApiKey,
  useDeletePlatformApiKey,
  useDeleteProjectApiKey,
  usePlatformApiKeysQuery,
  usePlatformQuery,
  useProjectApiKeysQuery,
} from '@/lib/query/hooks'

const PLATFORM_ADMIN_ROLE = 'ADMIN'

type RevokeTarget = {
  id: string
  displayName: string
  scope: 'project' | 'platform'
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-[52px] w-full rounded-xl" />
      <Skeleton className="h-[52px] w-full rounded-xl" />
    </div>
  )
}

export default function ApiKeysPage() {
  const { t } = useTranslation()
  const { user, projects, currentProject } = useAuth()
  const isPlatformAdmin = user?.platformRole === PLATFORM_ADMIN_ROLE

  const projectKeysQuery = useProjectApiKeysQuery()
  const createProjectKey = useCreateProjectApiKey()
  const deleteProjectKey = useDeleteProjectApiKey()

  // `currentProject.platformId` is the reliable source for the platform id on this
  // frontend — `user.platformId` is declared on the `User` type but never actually
  // populated by `/authentication/sign-in`, so it can't be used for gating here.
  const platformId = currentProject?.platformId
  const platformQuery = usePlatformQuery({ platformId })
  const platformInfoLoading = !currentProject || platformQuery.isLoading
  const platformKeysEnabled = isPlatformAdmin && platformQuery.data?.plan.apiKeysEnabled === true

  const platformKeysQuery = usePlatformApiKeysQuery({ enabled: platformKeysEnabled })
  const createPlatformKey = useCreatePlatformApiKey()
  const deletePlatformKey = useDeletePlatformApiKey()

  const [createOpen, setCreateOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<RevealedApiKey | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)

  const projectKeys = projectKeysQuery.data?.data ?? []
  const platformKeys = platformKeysQuery.data?.data ?? []

  const handleCreateProjectKey = async ({ displayName, projectId }: { displayName: string, projectId: string }) => {
    try {
      const created: ProjectApiKeyWithValue = await createProjectKey.mutateAsync({ displayName, projectId })
      setCreateOpen(false)
      setRevealedKey({ displayName: created.displayName, value: created.value })
    } catch (error) {
      toast.error(t('Could not create API key'), {
        description: error instanceof Error ? error.message : t('Try again.'),
      })
    }
  }

  const handleCreatePlatformKey = async ({ displayName }: { displayName: string }) => {
    try {
      const created: PlatformApiKeyWithValue = await createPlatformKey.mutateAsync({ displayName })
      setCreateOpen(false)
      setRevealedKey({ displayName: created.displayName, value: created.value })
    } catch (error) {
      toast.error(t('Could not create API key'), {
        description: error instanceof Error ? error.message : t('Try again.'),
      })
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    try {
      if (revokeTarget.scope === 'project') {
        await deleteProjectKey.mutateAsync({ id: revokeTarget.id })
      } else {
        await deletePlatformKey.mutateAsync({ id: revokeTarget.id })
      }
      toast.success(t('API key revoked'))
    } catch (error) {
      toast.error(t('Could not revoke API key'), {
        description: error instanceof Error ? error.message : t('Try again.'),
      })
    } finally {
      setRevokeTarget(null)
    }
  }

  const revokeProjectKey = (key: ApiKeyRow) =>
    setRevokeTarget({ id: key.id, displayName: key.displayName, scope: 'project' })
  const revokePlatformKey = (key: ApiKeyRow) =>
    setRevokeTarget({ id: key.id, displayName: key.displayName, scope: 'platform' })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('API Keys')}
        description={t('Create and manage credentials that authenticate programmatic and MCP access to InboxFM Connect.')}
        actions={
          <Button size="sm" className="gap-1.5 shadow-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span>{t('Create API Key')}</span>
          </Button>
        }
      />

      <Card className="shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <FolderKey className="h-4 w-4 text-primary" />
            <span>{t('Project API Keys')}</span>
            <Badge variant="secondary">cak-</Badge>
          </CardTitle>
          <CardDescription>
            {t('Project-scoped keys used by the Connect SDK/API (connect sessions, execute). Available on every edition.')}
            {currentProject
              ? ' ' +
                t('Showing keys for "{{projectName}}" — switch projects from the sidebar to manage others.', {
                  projectName: currentProject.displayName,
                })
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectKeysQuery.isLoading ? (
            <ListSkeleton />
          ) : projectKeysQuery.isError ? (
            <ErrorState
              title={t('Unable to load project API keys.')}
              description={t('Check that you are signed in and have access to this project, then try again.')}
              onRetry={() => void projectKeysQuery.refetch()}
            />
          ) : projectKeys.length === 0 ? (
            <EmptyState
              icon={FolderKey}
              title={t('No project API keys yet')}
              description={t("Create a key so your backend or AI agent can call the InboxFM Connect API on this project's behalf.")}
              actionLabel={t('Create your first API key')}
              onAction={() => setCreateOpen(true)}
              className="min-h-0 py-6"
            />
          ) : (
            <ApiKeysTable keys={projectKeys} keyPrefix="cak-" onRevoke={revokeProjectKey} />
          )}
        </CardContent>
      </Card>

      {isPlatformAdmin && (
        <Card className="shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-amber-500" />
              <span>{t('Platform API Keys')}</span>
              <Badge variant="outline">sk-</Badge>
            </CardTitle>
            <CardDescription>
              {t('Platform-wide keys that authenticate as the whole platform across every project. Handle these like root credentials.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {platformInfoLoading ? (
              <ListSkeleton />
            ) : !platformKeysEnabled ? (
              <EmptyState
                icon={Lock}
                title={t('Requires an upgraded plan')}
                description={t('Platform-wide API keys are available on Enterprise and Cloud plans. Project API keys above work on every edition, including Community.')}
                className="min-h-0 py-6"
              />
            ) : platformKeysQuery.isLoading ? (
              <ListSkeleton />
            ) : platformKeysQuery.isError ? (
              <ErrorState
                title={t('Unable to load platform API keys.')}
                description={t('Check that you still have platform admin access, then try again.')}
                onRetry={() => void platformKeysQuery.refetch()}
              />
            ) : platformKeys.length === 0 ? (
              <EmptyState
                icon={Building2}
                title={t('No platform API keys yet')}
                description={t('Create a platform-wide key for trusted backend services that need cross-project access.')}
                actionLabel={t('Create API Key')}
                onAction={() => setCreateOpen(true)}
                className="min-h-0 py-6"
              />
            ) : (
              <ApiKeysTable keys={platformKeys} keyPrefix="sk-" onRevoke={revokePlatformKey} />
            )}
          </CardContent>
        </Card>
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projects={projects}
        defaultProjectId={currentProject?.id}
        canCreatePlatformKey={platformKeysEnabled}
        creatingProjectKey={createProjectKey.isPending}
        creatingPlatformKey={createPlatformKey.isPending}
        onCreateProjectKey={(args) => void handleCreateProjectKey(args)}
        onCreatePlatformKey={(args) => void handleCreatePlatformKey(args)}
      />

      <RevealApiKeyDialog revealedKey={revealedKey} onClose={() => setRevealedKey(null)} />

      <RevokeApiKeyDialog
        keyName={revokeTarget?.displayName}
        open={!!revokeTarget}
        revoking={revokeTarget?.scope === 'project' ? deleteProjectKey.isPending : deletePlatformKey.isPending}
        onClose={() => setRevokeTarget(null)}
        onRevoke={() => void handleRevoke()}
      />
    </div>
  )
}
