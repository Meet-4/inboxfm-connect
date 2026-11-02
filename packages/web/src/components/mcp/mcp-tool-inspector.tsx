import { ExternalLink, Lock, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { McpToolInfo } from '@/lib/mcp/tool-registry'

export interface McpToolInspectorProps {
  tool: McpToolInfo | null
  enabled: boolean | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function McpToolInspector({ tool, enabled, open, onOpenChange }: McpToolInspectorProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        {tool && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono text-base">{tool.name}</DialogTitle>
              <DialogDescription className="pt-1 leading-relaxed">{tool.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5" data-testid="mcp-inspector-status">
                {enabled === null ? null : enabled ? (
                  <Badge variant="success" dot className="text-[10px]">
                    {t('Exposed to AI agents')}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {t('Hidden from AI agents')}
                  </Badge>
                )}
                {tool.locked && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    {t('Always available')}
                  </Badge>
                )}
                {tool.annotations.readOnly && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {t('Read-only hint')}
                  </Badge>
                )}
                {tool.annotations.destructive && (
                  <Badge variant="warning" className="gap-1 text-[10px]">
                    <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                    {t('Destructive hint')}
                  </Badge>
                )}
              </div>

              <div className="space-y-1.5" data-testid="mcp-inspector-params">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('Input parameters')}
                </span>
                {tool.params.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('This tool takes no parameters.')}</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-md border border-border">
                    {tool.params.map((param) => (
                      <li key={param.name} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <code className="font-mono text-xs font-medium text-foreground">{param.name}</code>
                        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <code>{param.type}</code>
                          {param.required && (
                            <Badge variant="outline" className="text-[9px]">
                              {t('required')}
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t('Tool calls execute through the existing runtime and show up in')}{' '}
                <Link to="/activity" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => onOpenChange(false)}>
                  {t('Activity')}
                </Link>
                .
              </p>

              {tool.name === 'ap_run_action' && (
                <Button size="sm" variant="outline" asChild className="gap-1.5" data-testid="mcp-open-in-actions">
                  <Link to="/actions" onClick={() => onOpenChange(false)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{t('Open in Actions')}</span>
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
