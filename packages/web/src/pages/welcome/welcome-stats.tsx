import { Blocks, Code2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function WelcomeStats() {
  const { t } = useTranslation()
  const stats = [
    { icon: Blocks, label: t('400+ integrations') },
    { icon: Code2, label: t('TypeScript 5.0, end to end') },
    { icon: ShieldCheck, label: t('MIT + dual license') },
  ]

  return (
    <div className="border-b border-border/80 bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 py-8 sm:px-6 lg:px-8">
        {stats.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className="h-4 w-4 text-primary" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
