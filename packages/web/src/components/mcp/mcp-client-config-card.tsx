import { Check, Copy, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { buildMcpClientConfig, MCP_CLIENT_META, MCP_CLIENTS, McpClient } from '@/lib/mcp/client-config'

export interface McpClientConfigCardProps {
  serverUrl: string
  bearerToken?: string
}

type AuthMode = 'oauth' | 'bearer'

const AUTH_MODES: Array<{ value: AuthMode; label: string; hint: string }> = [
  { value: 'oauth', label: 'OAuth (recommended)', hint: 'The client authorizes in the browser on first connect. No secret is stored in the config file.' },
  { value: 'bearer', label: 'Bearer token', hint: 'Embeds a short-lived access token in the config. Regenerate and update it when it expires.' },
]

export function McpClientConfigCard({ serverUrl, bearerToken }: McpClientConfigCardProps) {
  const [selectedClient, setSelectedClient] = useState<McpClient>('claude-desktop')
  const [authMode, setAuthMode] = useState<AuthMode>('oauth')
  const [copied, setCopied] = useState(false)

  const effectiveToken = authMode === 'bearer' ? bearerToken : undefined
  const config = useMemo(
    () => buildMcpClientConfig({ client: selectedClient, serverUrl, bearerToken: effectiveToken }),
    [selectedClient, serverUrl, effectiveToken]
  )
  const containsCredential = !!effectiveToken

  const copyConfig = async () => {
    await navigator.clipboard.writeText(config)
    setCopied(true)
    toast.success(`Copied ${MCP_CLIENT_META[selectedClient].label} configuration`)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-border shadow-xs">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold">Client Configuration</CardTitle>
        <CardDescription className="text-xs">
          Paste into your client&apos;s MCP config to connect it to this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="tablist" aria-label="MCP client" className="flex flex-wrap gap-1.5" data-testid="mcp-client-tabs">
          {MCP_CLIENTS.map((client) => (
            <button
              key={client}
              type="button"
              role="tab"
              aria-selected={selectedClient === client}
              onClick={() => setSelectedClient(client)}
              className={
                'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ' +
                (selectedClient === client
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'border border-border bg-card text-muted-foreground hover:bg-muted')
              }
            >
              {MCP_CLIENT_META[client].label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="mcp-auth-mode" className="sr-only">
            Authentication mode
          </label>
          <select
            id="mcp-auth-mode"
            value={authMode}
            onChange={(event) => setAuthMode(event.target.value as AuthMode)}
            className="h-8 w-full cursor-pointer rounded-md border border-input bg-card px-2.5 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            data-testid="mcp-auth-mode-select"
          >
            {AUTH_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
          <p id="mcp-auth-mode-hint" className="text-[11px] leading-relaxed text-muted-foreground">
            {authMode === 'bearer' && !bearerToken
              ? 'Generate a token first — the configuration below has no Authorization header until you do.'
              : AUTH_MODES.find((mode) => mode.value === authMode)?.hint}
          </p>
        </div>

        <div className="relative">
          <pre
            data-testid={`mcp-config-${selectedClient}`}
            aria-label={`${MCP_CLIENT_META[selectedClient].label} configuration`}
            className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed"
          >
            {config}
          </pre>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => void copyConfig()}
            aria-label={`Copy ${MCP_CLIENT_META[selectedClient].label} configuration`}
            data-testid="mcp-copy-config"
            className="absolute right-2 top-2 bg-card/90 backdrop-blur"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {containsCredential && (
          <Badge variant="warning" className="gap-1 text-[10px]" data-testid="mcp-config-secret-warning">
            <Info className="h-3 w-3" aria-hidden="true" />
            This configuration contains a credential.
          </Badge>
        )}

        <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={MCP_CLIENT_META[selectedClient].configPath}>
          {MCP_CLIENT_META[selectedClient].configPath}
        </p>
      </CardContent>
    </Card>
  )
}
