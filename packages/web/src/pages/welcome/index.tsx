import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { WelcomeCta } from './welcome-cta'
import { WelcomeFeatures } from './welcome-features'
import { WelcomeFooter } from './welcome-footer'
import { WelcomeHero } from './welcome-hero'
import { WelcomeNav } from './welcome-nav'
import { WelcomeStats } from './welcome-stats'

export default function WelcomePage() {
  const { t } = useTranslation()
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('InboxFM Connect — AI-first workflow automation')
    return () => {
      document.title = previousTitle
    }
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <WelcomeNav />
      <main>
        <WelcomeHero />
        <WelcomeStats />
        <WelcomeFeatures />
        <WelcomeCta />
      </main>
      <WelcomeFooter />
    </div>
  )
}
