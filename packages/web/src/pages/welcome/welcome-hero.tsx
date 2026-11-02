import { ArrowRight, Github, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { welcomeLinks } from './welcome-links'

export function WelcomeHero() {
  const { t } = useTranslation()
  return (
    <section className="relative overflow-hidden border-b border-border/80">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.12),_transparent_60%)]"
      />

      <div className="relative mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
        <Badge variant="outline" className="mx-auto gap-1.5 border-primary/30 bg-primary/5 text-primary">
          <Sparkles className="h-3 w-3" />
          <span>{t('Open source · Fork of Activepieces')}</span>
        </Badge>

        <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {t('Workflow automation built for')}{' '}
          <span className="bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent">
            {t('AI agents')}
          </span>
          {t(', not just humans.')}
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
          {t('Inboxfm Connect is an open-source, AI-first workflow automation platform for AI agents, developers, and teams. Native Model Context Protocol (MCP) servers, 400+ integrations, and a type-safe integrations framework — self-hosted or in the cloud.')}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild className="gap-2">
            <Link to="/login">
              <span>{t('Sign In')}</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="gap-2">
            <a href={welcomeLinks.githubRepo} target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              <span>{t('View on GitHub')}</span>
            </a>
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {t('Self-host with Docker in minutes — see the')}{' '}
          <a
            href={welcomeLinks.githubReadme}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          >
            {t('Quick Start guide')}
          </a>
          .
        </p>
      </div>
    </section>
  )
}
