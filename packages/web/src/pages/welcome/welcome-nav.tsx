import { Github } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LogoMark } from './logo-mark'
import { welcomeLinks } from './welcome-links'

export function WelcomeNav() {
  const { t } = useTranslation()
  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/welcome" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-base font-bold tracking-tight">InboxFM Connect</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground transition-colors">
            {t('Features')}
          </a>
          <a
            href={welcomeLinks.githubRepo}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex gap-2">
            <a href={welcomeLinks.githubRepo} target="_blank" rel="noopener noreferrer">
              <Github className="h-4 w-4" />
              <span>{t('Star on GitHub')}</span>
            </a>
          </Button>
          <Button size="sm" asChild>
            <Link to="/login">{t('Sign In')}</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
