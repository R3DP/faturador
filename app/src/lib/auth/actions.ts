'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { appUrl } from '@/lib/mcp/shared'
import { guardAuthAttempt, recordAuthFailure } from './guard'
import { parseSignUpInput } from './signup-input'
import { admitAccount, signupIsOpen } from './admission'
import { ACCESS_CHECK_FAILED_MESSAGE, SIGNUP_CLOSED_MESSAGE } from './signup-closed'

/**
 * Ações de servidor para solicitações de entrada, cadastro e redefinição de senha.
 *
 * Elas garantem que a autenticação passe por um servidor sob nosso controle.
 * Antes, as páginas de autenticação chamavam supabase.auth.* diretamente do
 * navegador, sem nenhum ponto no caminho da solicitação onde fosse possível
 * aplicar um limite de tentativas: um invasor poderia testar senhas contra o
 * Supabase Auth na velocidade permitida pelo serviço, sem passar por nós.
 *
 * Executar as chamadas por @/lib/supabase/server também coloca o gerenciamento
 * do cookie de sessão no servidor, onde ele deve ficar.
 *
 * A conclusão da REDEFINIÇÃO DE SENHA (updateUser após acessar o link enviado
 * por e-mail) continua deliberadamente no cliente: esse fluxo precisa da sessão
 * de recuperação que o Supabase estabelece a partir do fragmento da URL, que
 * nunca chega ao servidor. Além disso, não é uma superfície para tentativa de
 * adivinhar credenciais, pois exige um token de recuperação válido e de uso único.
 */

export interface AuthActionResult {
  success: boolean
  error?: string
  /** Definido quando a pessoa que fez a solicitação atingiu o limite ou foi bloqueada, como indicação no estilo Retry-After. */
  retryAfterSeconds?: number
}

const emailSchema = z.string().trim().min(1).max(320).email()

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
})

const resetSchema = z.object({ email: emailSchema })

// A mensagem é genérica de propósito. Diferenciar "conta inexistente" de
// "senha incorreta" transformaria o formulário de entrada em uma ferramenta
// para descobrir quais contas existem.
const INVALID_CREDENTIALS = 'E-mail ou senha incorretos. Tente novamente.'

/**
 * Verifica se esta conta pode usar a instalação. Retorna a decisão ou
 * 'unavailable' quando o banco de dados não consegue responder (nunca admite a conta).
 */
async function admission(userId: string): Promise<boolean | null | 'unavailable'> {
  try {
    return await admitAccount(userId)
  } catch {
    return 'unavailable'
  }
}

export async function signInAction(input: {
  email: string
  password: string
}): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: INVALID_CREDENTIALS }
  }
  const { email, password } = parsed.data

  const guard = await guardAuthAttempt('signin', email)
  if (guard.blocked) {
    return { success: false, error: guard.message, retryAfterSeconds: guard.retryAfterSeconds }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    await recordAuthFailure(email, guard.ip)
    return { success: false, error: INVALID_CREDENTIALS }
  }

  // O cadastro fecha após a primeira conta. Uma conta que nunca foi admitida
  // (por exemplo, criada diretamente no Supabase Auth) não recebe uma sessão.
  const admitted = data.user ? await admission(data.user.id) : false
  if (admitted !== true) {
    await supabase.auth.signOut()
    return {
      success: false,
      error: admitted === 'unavailable' ? ACCESS_CHECK_FAILED_MESSAGE : SIGNUP_CLOSED_MESSAGE,
    }
  }

  return { success: true }
}

export interface SignUpActionResult extends AuthActionResult {
  /** Indica que o Supabase retornou uma sessão ativa (a confirmação automática por e-mail está ativada). */
  hasSession?: boolean
}

export async function signUpAction(input: {
  email: string
  password: string
  fullName: string
}): Promise<SignUpActionResult> {
  const parsed = parseSignUpInput(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error }
  }
  const { email, password, fullName } = parsed.data

  const guard = await guardAuthAttempt('signup', email)
  if (guard.blocked) {
    return { success: false, error: guard.message, retryAfterSeconds: guard.retryAfterSeconds }
  }

  if (!(await signupIsOpen())) {
    return { success: false, error: SIGNUP_CLOSED_MESSAGE }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  })

  if (error) {
    // Um cadastro rejeitado conta como tentativa malsucedida: o cadastro é
    // outro endpoint que um invasor pode usar para descobrir quais endereços
    // já estão registrados.
    await recordAuthFailure(email, guard.ip)
    return { success: false, error: error.message }
  }

  // Resolve a disputa entre dois primeiros cadastros: somente um se torna responsável.
  if (data.user) {
    const admitted = await admission(data.user.id)
    if (admitted === false || admitted === 'unavailable') {
      await supabase.auth.signOut()
      return {
        success: false,
        error: admitted === 'unavailable' ? ACCESS_CHECK_FAILED_MESSAGE : SIGNUP_CLOSED_MESSAGE,
      }
    }
  }

  return { success: true, hasSession: !!data.session }
}

export async function requestPasswordResetAction(input: {
  email: string
}): Promise<AuthActionResult> {
  const parsed = resetSchema.safeParse(input)
  // Sempre informa sucesso para um endereço inválido ou desconhecido: o formulário
  // de redefinição não deve revelar se uma conta existe.
  if (!parsed.success) return { success: true }

  const { email } = parsed.data

  const guard = await guardAuthAttempt('reset', email)
  if (guard.blocked) {
    return { success: false, error: guard.message, retryAfterSeconds: guard.retryAfterSeconds }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/api/auth/callback?next=/reset-password`,
  })

  if (error) {
    console.error('requestPasswordResetAction:', error.message)
    // Ainda é sucesso para quem fez a solicitação, pelo mesmo motivo de não
    // revelar contas existentes. O limite de tentativas já foi consumido.
    return { success: true }
  }

  return { success: true }
}

/** Indica se a página de cadastro deve exibir o formulário. */
export async function signupStatusAction(): Promise<{ open: boolean }> {
  return { open: await signupIsOpen() }
}
