'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { ClientForm } from '@/components/clients/client-form'
import { useBusiness } from '@/lib/hooks/use-business'
import { createClientAction } from '@/lib/actions/clients'
import type { ClientFormData } from '@/lib/validations/client'

export default function NewClientPage() {
  const router = useRouter()
  const { currentBusiness } = useBusiness()

  async function handleSubmit(data: ClientFormData) {
    if (!currentBusiness) return

    await createClientAction(currentBusiness.id, data)
    router.push('/clients')
  }

  if (!currentBusiness) {
    return null
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Adicionar cliente"
        description="Adicione um novo cliente à sua empresa"
      />

      <Card className="mx-auto mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle>Informações do cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientForm
            onSubmit={handleSubmit}
            onCancel={() => router.back()}
          />
        </CardContent>
      </Card>
    </div>
  )
}

