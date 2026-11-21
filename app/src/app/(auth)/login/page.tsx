'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInAction } from '@/lib/auth/actions'
import { OAuthSignIn } from '@/components/auth/oauth-sign-in'
import { safeAuthRedirect } from '@/lib/auth/redirect'
import { ACCESS_CHECK_FAILED_MESSAGE, SIGNUP_CLOSED_MESSAGE } from '@/lib/auth/signup-closed'

const loginSchema = z.object({
  email: z.string().email('Informe um endereço de e-mail válido'),
  password: z.string().min(1, 'A senha é obrigatória'),
})

type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = safeAuthRedirect(searchParams.get('redirect'))
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginForm) {
    setError(null)

    // Passa por uma ação de servidor em vez de chamar o Supabase pelo
    // navegador, para que a tentativa passe pelo limite de requisições e bloqueio contra abuso que controlamos
    // (src/lib/auth/guard.ts) antes de chegar ao provedor de autenticação.
    const result = await signInAction({
      email: data.email,
      password: data.password,
    })

    if (!result.success) {
      setError(result.error ?? 'Não foi possível entrar. Tente novamente.')
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Boas-vindas de volta
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Entre na sua conta para continuar
        </p>
      </div>

      {searchParams.get('error') === 'auth' && (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
        >
          A entrada foi cancelada ou o link expirou. Tente novamente.
        </p>
      )}
      {searchParams.get('error') === 'signup_closed' && (
        <p role="alert" className="mt-5 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {SIGNUP_CLOSED_MESSAGE}
        </p>
      )}
      {searchParams.get('error') === 'access_check' && (
        <p role="alert" className="mt-5 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
          {ACCESS_CHECK_FAILED_MESSAGE}
        </p>
      )}
      <OAuthSignIn next={redirect} />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <Link
              href="/forgot-password"
              className="text-sm text-primary hover:underline"
            >
              Esqueceu a senha?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Entrar
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Ainda não tem uma conta?{' '}
        <Link href="/signup" className="text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </div>
  )
}
