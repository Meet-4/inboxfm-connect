import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface McpTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  token: string
  serverUrl?: string
}

export function McpTokenDialog({ open, onOpenChange, token, serverUrl }: McpTokenDialogProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) {
      setCopied(false)
    }
  }, [open])

  const copy = async () => {
    await navigator.clipboard.writeText(token)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('New MCP access token')}</DialogTitle>
          <DialogDescription>
            {t('Copy it now. This token is shown only once and expires in about 15 minutes.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <pre
            data-testid="mcp-generated-token"
            aria-label={t('Generated MCP token')}
            className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed"
          >
            {token}
          </pre>

          {serverUrl && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('Server URL')}
              </span>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                {serverUrl}
              </pre>
            </div>
          )}

          <p
            role="alert"
            data-testid="mcp-token-warning"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('This token will not be shown again. Store it in your MCP client configuration before closing this dialog.')}</span>
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button size="sm" onClick={() => void copy()} aria-label={t('Copy token to clipboard')}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>{t('Copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>{t('Copy token')}</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
