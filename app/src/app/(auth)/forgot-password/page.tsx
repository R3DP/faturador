'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestPasswordResetAction } from '@/lib/auth/actions'

const forgotPasswordSchema = z.object({
  email: z.string().email('Informe um endereço de e-mail válido'),
})

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit(data: ForgotPasswordForm) {
    setError(null)
    // A ação de servidor impede que o endpoint de redefinição de senha seja usado como
    // um disparador de e-mails sem limite e garante que a resposta nunca revele se uma
    // conta existe (src/lib/auth/actions.ts).
    const result = await requestPasswordResetAction({ email: data.email })

    if (!result.success) {
      setError(result.error ?? 'Não foi possível enviar o e-mail de redefinição. Tente novamente.')
      return
    }

    setSuccess(true)
  }

  if (success) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <svg
            className="h-6 w-6 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Confira seu e-mail
        </h1>
        <p className="mt-2 text-muted-foreground">
          Enviamos um link para redefinir sua senha. Confira seu e-mail.
        </p>
        <Button className="mt-6" variant="outline" asChild>
          <Link href="/login">Voltar para entrar</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <Link
        href="/login"
        className="mb-6 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Voltar para entrar
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Redefinir sua senha
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Informe seu endereço de e-mail e enviaremos um link para redefinir sua senha.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-sm text-destructive">{errors.email.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar link de redefinição
        </Button>
      </form>
    </div>
  )
}

