import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { McpToolPermissionToggle } from '@/components/mcp/mcp-tool-permission-toggle'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { McpToolInfo } from '@/lib/mcp/tool-registry'
import { cn } from '@/lib/utils/cn'

export interface McpToolTableProps {
  tools: McpToolInfo[]
  disabledTools: ReadonlySet<string>
  pendingTools: ReadonlySet<string>
  onToggle: (tool: McpToolInfo, nextEnabled: boolean) => void
  onSelect: (tool: McpToolInfo) => void
}

export function McpToolTable({ tools, disabledTools, pendingTools, onToggle, onSelect }: McpToolTableProps) {
  const { t } = useTranslation()

  if (tools.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-card/50 p-4 text-center text-xs text-muted-foreground" data-testid="mcp-tool-empty">
        {t('No tools match the current search or filters.')}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto" data-testid="mcp-tool-table">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="pb-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Tool')}
            </th>
            <th scope="col" className="pb-2 pl-3 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Exposed')}
            </th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => {
            const enabled = tool.locked || !disabledTools.has(tool.name)
            return (
              <tr
                key={tool.name}
                data-testid={`mcp-tool-row-${tool.name}`}
                data-enabled={enabled ? 'true' : 'false'}
                className={cn('border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30', !enabled && 'opacity-60')}
              >
                <td className="py-2.5 pr-3 align-top">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground" aria-hidden="true">
                      <Wrench className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelect(tool)}
                        className="block rounded font-mono text-xs font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        aria-label={t('Inspect {{toolName}}', { toolName: tool.name })}
                        data-testid={`mcp-tool-name-${tool.name}`}
                      >
                        {tool.name}
                      </button>
                      <p className="mt-0.5 line-clamp-2 max-w-md text-[11px] leading-relaxed text-muted-foreground">
                        {tool.description}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {tool.annotations.readOnly && (
                          <Badge variant="outline" className="text-[9px] text-muted-foreground">
                            {t('Read-only')}
                          </Badge>
                        )}
                        {tool.annotations.destructive && (
                          <Badge variant="warning" className="text-[9px]">
                            {t('Destructive')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pl-3 text-right align-top">
                  <span id={`mcp-tool-status-${tool.name}`} className="sr-only">
                    {enabled ? t('Exposed to AI agents') : t('Hidden from AI agents')}
                  </span>
                  <McpToolPermissionToggle
                    toolName={tool.name}
                    enabled={enabled}
                    locked={tool.locked}
                    pending={pendingTools.has(tool.name)}
                    onToggle={(next) => onToggle(tool, next)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function McpToolTableSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true" data-testid="mcp-tool-table-skeleton">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full max-w-sm" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  )
}
