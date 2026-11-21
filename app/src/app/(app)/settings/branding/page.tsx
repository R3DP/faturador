'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsLayout } from '@/components/settings/settings-layout'
import { useBusiness } from '@/lib/hooks/use-business'
import { createClient } from '@/lib/supabase/client'
import { updateBrandingAction } from '@/lib/actions/business'

export default function BrandingSettingsPage() {
  const { currentBusiness, refreshBusinesses, isLoading } = useBusiness()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState(currentBusiness?.primary_color || '#2563eb')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // As empresas carregam de forma assíncrona; sincroniza o estado local quando os dados chegam
  useEffect(() => {
    if (currentBusiness) {
      setPrimaryColor(currentBusiness.primary_color || '#2563eb')
    }
  }, [currentBusiness])

  async function handleLogoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Permite selecionar o mesmo arquivo novamente depois
    event.target.value = ''
    if (!file || !currentBusiness) return

    if (file.size > 2 * 1024 * 1024) {
      toast.error('O logotipo deve ter no máximo 2 MB')
      return
    }

    setIsUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() || 'png'
      const path = `${currentBusiness.id}/logo-${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(path, file)

      if (uploadError) {
        toast.error(uploadError.message)
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('logos')
        .getPublicUrl(path)

      const result = await updateBrandingAction(currentBusiness.id, {
        logo_url: publicUrl,
      })

      if ('error' in result) {
        toast.error(result.error)
        return
      }

      setLogoPreview(publicUrl)
      refreshBusinesses()
      toast.success('Logotipo atualizado')
    } finally {
      setIsUploading(false)
    }
  }

  async function handleSaveColor() {
    if (!currentBusiness) return

    setIsSubmitting(true)
    setMessage(null)

    const result = await updateBrandingAction(currentBusiness.id, {
      primary_color: primaryColor,
    })

    setIsSubmitting(false)

    if ('error' in result) {
      setMessage({ type: 'error', text: result.error })
    } else {
      setMessage({ type: 'success', text: 'Identidade visual atualizada' })
      refreshBusinesses()
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!currentBusiness) {
    return null
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Configurações"
        description="Gerencie as configurações e preferências da sua empresa"
      />

      <div className="mt-6">
        <SettingsLayout>
          <div className="space-y-6">
            {message && (
              <div
                className={`rounded-lg p-3 text-sm ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {message.text}
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Logotipo</CardTitle>
                <CardDescription>
                  Seu logotipo aparecerá nas faturas e nos orçamentos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoSelect}
                />
                {(logoPreview || currentBusiness.logo_url) ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <img
                        src={logoPreview || currentBusiness.logo_url || undefined}
                        alt="Logotipo da empresa"
                        className="h-16 w-auto rounded border"
                      />
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Alterar logotipo
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Envie o logotipo da sua empresa
                    </p>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Escolher arquivo
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      PNG ou JPG de até 2 MB. Tamanho recomendado: 400 × 200 px
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cor da marca</CardTitle>
                <CardDescription>
                  Esta cor será usada nas faturas e na página de pagamento
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div
                    className="h-12 w-12 rounded-lg border"
                    style={{ backgroundColor: primaryColor }}
                  />
                  <div className="flex-1">
                    <Label htmlFor="primary_color">Cor principal</Label>
                    <div className="mt-1 flex gap-2">
                      <Input
                        id="primary_color"
                        type="color"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="h-10 w-20 cursor-pointer p-1"
                      />
                      <Input
                        type="text"
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="flex-1 font-mono"
                        placeholder="#2563eb"
                      />
                    </div>
                  </div>
                </div>

                {/* Prévia */}
                <div className="rounded-lg border p-4">
                  <p className="mb-2 text-sm font-medium text-muted-foreground">Prévia</p>
                  <div className="space-y-2">
                    <div
                      className="rounded px-4 py-2 text-white"
                      style={{ backgroundColor: primaryColor }}
                    >
                      Botão principal
                    </div>
                    <h2
                      className="text-2xl font-bold"
                      style={{ color: primaryColor }}
                    >
                      FATURA
                    </h2>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handleSaveColor} disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar cor
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </SettingsLayout>
      </div>
    </div>
  )
}

