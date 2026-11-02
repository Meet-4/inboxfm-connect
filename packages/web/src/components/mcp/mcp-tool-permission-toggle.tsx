import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils/cn'

export interface McpToolPermissionToggleProps {
  toolName: string
  enabled: boolean
  locked?: boolean
  pending?: boolean
  onToggle?: (nextEnabled: boolean) => void
}

export function McpToolPermissionToggle({
  toolName,
  enabled,
  locked = false,
  pending = false,
  onToggle,
}: McpToolPermissionToggleProps) {
  const { t } = useTranslation()
  if (locked) {
    return (
      <span
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
        title={t('{{toolName}} is always exposed to AI agents', { toolName })}
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">{t('{{toolName}} is always exposed and cannot be disabled', { toolName })}</span>
      </span>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={t('Expose {{toolName}} to AI agents', { toolName })}
      aria-describedby={`mcp-tool-status-${toolName}`}
      disabled={pending}
      data-testid={`mcp-tool-toggle-${toolName}`}
      data-state={enabled ? 'on' : 'off'}
      onClick={() => onToggle?.(!enabled)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60',
        enabled ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform',
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}
