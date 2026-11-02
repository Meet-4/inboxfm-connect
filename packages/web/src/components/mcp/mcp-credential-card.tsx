import { KeyRound, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { McpTokenDialog } from '@/components/mcp/mcp-token-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PopulatedMcpServer } from '@/lib/api/types'
import { mcpErrors } from '@/lib/mcp/mcp-errors'
import { useGenerateMcpToken, useRotateMcpToken } from '@/lib/query/hooks'

export interface McpCredentialCardProps {
  server: PopulatedMcpServer | undefined
  projectId: string
  onServerUrlDiscovered?: (serverUrl: string) => void
  onTokenGenerated?: (token: string) => void
}

function maskToken(token: string): string {
  if (!token) {
    return '—'
  }
  return `${token.slice(0, 4)}${'•'.repeat(12)}`
}

export function McpCredentialCard({ server, projectId, onServerUrlDiscovered, onTokenGenerated }: McpCredentialCardProps) {
  const { t } = useTranslation()
  const generateMutation = useGenerateMcpToken()
  const rotateMutation = useRotateMcpToken()
  const [generated, setGenerated] = useState<{ token: string; serverUrl: string } | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({ projectId })
      setGenerated({ token: result.mcpToken, serverUrl: result.mcpServerUrl })
      onServerUrlDiscovered?.(result.mcpServerUrl)
      onTokenGenerated?.(result.mcpToken)
    } catch (error) {
      toast.error(t('Could not generate an MCP token'), {
        description: mcpErrors.describe(error, t('Try again in a moment.')),
      })
    }
  }

  const handleRotate = async () => {
    try {
      await rotateMutation.mutateAsync({ projectId })
      toast.success(t('MCP server token rotated'), {
        description: t('Clients authenticating with credentials derived from the previous token may need to reconnect.'),
      })
      setRotateOpen(false)
    } catch (error) {
      toast.error(t('Could not rotate the MCP token'), {
        description: mcpErrors.describe(error, t('Try again in a moment.')),
      })
    }
  }

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          <span>{t('Credentials')}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {t('How AI agents authenticate against the MCP endpoint.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2" data-testid="mcp-credential-auth-modes">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">{t('OAuth (recommended)')}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t('Claude Desktop, Cursor and Windsurf can authorize against this server on first connect — no token needed in the config. Just add the server URL.')}
            </p>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs font-semibold text-foreground">{t('Bearer token')}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {t('For clients without OAuth support. Generates a short-lived token (~15 minutes) tied to your account and this project.')}
            </p>
            <Button
              size="sm"
              onClick={() => void handleGenerate()}
              loading={generateMutation.isPending}
              className="mt-2 gap-1.5"
              data-testid="mcp-generate-token"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{t('Generate Token')}</span>
            </Button>
          </div>
        </div>

        <div className="space-y-1.5 border-t border-border pt-3" data-testid="mcp-server-token-section">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('Server token')}
          </span>
          <div className="flex items-center justify-between gap-2">
            <code
              aria-label={t('Server token, masked')}
              className="min-w-0 truncate rounded-md border border-input bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground"
            >
              {server ? maskToken(server.token) : '••••••••••••'}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRotateOpen(true)}
              loading={rotateMutation.isPending}
              className="gap-1.5 shrink-0"
              data-testid="mcp-rotate-token"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t('Rotate Token')}</span>
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('Rotating replaces the internal server token. Existing client connections are not interrupted.')}
          </p>
        </div>

      </CardContent>

      <McpTokenDialog
        open={generated !== null}
        onOpenChange={(open) => {
          if (!open) {
            setGenerated(null)
          }
        }}
        token={generated?.token ?? ''}
        serverUrl={generated?.serverUrl}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={t('Rotate MCP token?')}
        description={t('The current server token will be replaced by a new one. Clients that copied or stored the old token may stop working until they pick up the new one.')}
        confirmLabel={t('Rotate Token')}
        variant="destructive"
        loading={rotateMutation.isPending}
        onConfirm={() => void handleRotate()}
      />
    </Card>
  )
}
