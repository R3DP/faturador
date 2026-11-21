'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { WorkspaceHeader } from './workspace-header'
import { Sidebar } from './sidebar'
import { MobileNav } from './mobile-nav'
import { useBusiness } from '@/lib/hooks/use-business'
import { SetupProgress } from '@/components/onboarding/setup-progress'
import { Tour } from '@/components/onboarding/tour'
import { HelpLauncher } from '@/components/onboarding/help-launcher'
import { useOnboarding } from '@/lib/onboarding/use-onboarding'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const { businesses, isLoading } = useBusiness()
  const onboarding = useOnboarding()

  // No modo normal, usuários sem empresa passam primeiro pela configuração inicial.
  // /onboarding fica fora do grupo (app), evitando um redirecionamento em loop.
  const needsOnboarding =
    !isLoading && businesses.length === 0

  useEffect(() => {
    if (needsOnboarding) {
      router.replace('/onboarding')
    }
  }, [needsOnboarding, router])

  if (needsOnboarding) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="app-workspace flex h-dvh">
      {/* Barra lateral para computador */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Conteúdo principal */}
      <div className="workspace-frame flex flex-1 flex-col overflow-hidden">
        {/* Navegação para celular */}
        <MobileNav />
        <WorkspaceHeader />

        {/* Conteúdo da página */}
        <main className="workspace-content relative flex-1 overflow-y-auto">
          <SetupProgress />
          {children}
        </main>
      </div>

      <Tour onboarding={onboarding} />
      <HelpLauncher onboarding={onboarding} />
    </div>
  )
}
