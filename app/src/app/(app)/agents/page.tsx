'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { AgentsTabs } from '@/components/agents/agents-tabs'

export default function AgentsPage() {
  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Agentes"
        description="Conecte agentes à sua conta Faturador e gerencie chaves, pagamentos, atividades e receitas"
      />

      <div className="mt-6">
        <Suspense
          fallback={
            <div role="status" aria-live="polite" className="flex h-32 items-center justify-center">
              <span className="sr-only">Carregando agentes...</span>
              <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <AgentsTabs />
        </Suspense>
      </div>
    </div>
  )
}
