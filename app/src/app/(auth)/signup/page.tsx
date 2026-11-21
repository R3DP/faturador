'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OAuthSignIn } from '@/components/auth/oauth-sign-in'
import { signUpAction, signupStatusAction } from '@/lib/auth/actions'
import { SIGNUP_CLOSED_MESSAGE } from '@/lib/auth/signup-closed'

const signupSchema = z.object({
  fullName: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres'),
  email: z.string().email('Informe um endereço de e-mail válido'),
  password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
})

type SignupForm = z.infer<typeof signupSchema>

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    signupStatusAction()
      .then((status) => setOpen(status.open))
      .catch(() => setOpen(false))
  }, [])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
  })

  async function onSubmit(data: SignupForm) {
    setError(null)
    // A ação de servidor, em vez de uma chamada direta do navegador ao Supabase, faz com que a tentativa
    // passe primeiro pelo nosso limite de requisições e bloqueio contra abuso (src/lib/auth/guard.ts).
    const result = await signUpAction({
      email: data.email,
      password: data.password,
      fullName: data.fullName,
    })

    if (!result.success) {
      setError(
        result.error ?? 'Não foi possível criar sua conta. Tente novamente.',
      )
      return
    }

    // A confirmação automática de e-mail está ativada, então signUp retorna uma sessão ativa
    if (result.hasSession) {
      router.push('/onboarding')
      router.refresh()
      return
    }

    // Alternativa: é necessário confirmar pelo e-mail
    setEmailSent(true)
  }

  if (open === false) {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold">O cadastro está fechado</h1>
        <p className="mt-2 text-sm text-muted-foreground">{SIGNUP_CLOSED_MESSAGE}</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium underline">
          Já tem uma conta? Entre
        </Link>
      </div>
    )
  }

  if (emailSent) {
    return (
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <Check className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">
          Confira seu e-mail
        </h1>
        <p className="mt-3 text-muted-foreground">
          Enviamos um link de confirmação. Confira seu e-mail para
          confirmar sua conta.
        </p>
        <Button className="mt-8" variant="outline" asChild>
          <Link href="/login">
            Voltar para entrar
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Criar sua conta
        </h1>
      </div>

      <OAuthSignIn />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="fullName">Nome completo</Label>
          <Input
            id="fullName"
            type="text"
            placeholder="João da Silva"
            autoComplete="name"
            {...register('fullName')}
          />
          {errors.fullName && (
            <p className="text-sm text-destructive">
              {errors.fullName.message}
            </p>
          )}
        </div>

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

        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            placeholder="Mín. 8 caracteres"
            autoComplete="new-password"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Criar conta
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Já tem uma conta?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  )
}
