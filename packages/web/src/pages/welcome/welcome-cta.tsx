import { ArrowRight, Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { welcomeLinks } from './welcome-links'

export function WelcomeCta() {
  const { t } = useTranslation()
  return (
    <section className="border-y border-border/80 bg-card/40">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t('Self-hosted or cloud — same open-source core.')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          {t('Run it yourself with Docker and Postgres, or sign in to an existing project. Either way, you get the same MCP-first automation engine.')}
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild className="gap-2">
            <Link to="/login">
              <span>{t('Sign In')}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="gap-2">
            <a href={welcomeLinks.githubRepo} target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              <span>{t('Self-Host on GitHub')}</span>
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}
