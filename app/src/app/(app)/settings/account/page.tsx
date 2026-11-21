'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsLayout } from '@/components/settings/settings-layout'
import { useBusiness } from '@/lib/hooks/use-business'
import { createClient } from '@/lib/supabase/client'

const profileSchema = z.object({
  full_name: z.string().min(1, 'O nome é obrigatório'),
})

const passwordSchema = z.object({
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "As senhas não coincidem.",
  path: ['confirmPassword'],
})

type ProfileForm = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export default function AccountSettingsPage() {
  const router = useRouter()
  const { profile } = useBusiness()
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false)
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const {
    register: registerProfile,
    handleSubmit: handleSubmitProfile,
    reset: resetProfile,
    formState: { errors: profileErrors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: profile?.full_name || '',
    },
  })

  // O perfil carrega de forma assíncrona; sincroniza o formulário quando os dados chegam
  useEffect(() => {
    if (profile) {
      resetProfile({ full_name: profile.full_name || '' })
    }
  }, [profile, resetProfile])

  const {
    register: registerPassword,
    handleSubmit: handleSubmitPassword,
    reset: resetPassword,
    formState: { errors: passwordErrors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  })

  async function onSubmitProfile(data: ProfileForm) {
    if (!profile) return

    setIsSubmittingProfile(true)
    setMessage(null)

    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: data.full_name })
      .eq('id', profile.id)

    setIsSubmittingProfile(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Perfil atualizado' })
    }
  }

  async function onSubmitPassword(data: PasswordForm) {
    setIsSubmittingPassword(true)
    setMessage(null)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({
      password: data.password,
    })

    setIsSubmittingPassword(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Senha atualizada' })
      resetPassword()
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
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

            {/* Perfil */}
            <Card>
              <CardHeader>
                <CardTitle>Perfil</CardTitle>
                <CardDescription>Informações da sua conta pessoal</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitProfile(onSubmitProfile)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Nome completo</Label>
                    <Input id="full_name" {...registerProfile('full_name')} />
                    {profileErrors.full_name && (
                      <p className="text-sm text-destructive">
                        {profileErrors.full_name.message}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSubmittingProfile}>
                      {isSubmittingProfile && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Atualizar perfil
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Senha */}
            <Card>
              <CardHeader>
                <CardTitle>Alterar senha</CardTitle>
                <CardDescription>Atualize a senha da sua conta</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitPassword(onSubmitPassword)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="password">Nova senha</Label>
                    <Input
                      id="password"
                      type="password"
                      {...registerPassword('password')}
                    />
                    {passwordErrors.password && (
                      <p className="text-sm text-destructive">
                        {passwordErrors.password.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirmar senha</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      {...registerPassword('confirmPassword')}
                    />
                    {passwordErrors.confirmPassword && (
                      <p className="text-sm text-destructive">
                        {passwordErrors.confirmPassword.message}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSubmittingPassword}>
                      {isSubmittingPassword && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Atualizar senha
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Sair */}
            <Card>
              <CardHeader>
                <CardTitle>Sair</CardTitle>
                <CardDescription>Desconecte sua conta neste dispositivo</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleSignOut}>
                  Sair
                </Button>
              </CardContent>
            </Card>
          </div>
        </SettingsLayout>
      </div>
    </div>
  )
}

