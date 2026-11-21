import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'

type ServiceDb = ReturnType<typeof createServiceClient>

/** BILLR_OPEN_SIGNUP=true mantém o cadastro aberto após a primeira conta. */
export function openSignup(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLR_OPEN_SIGNUP?.trim().toLowerCase() === 'true'
}

/**
 * Antes de criar uma conta: fica aberto quando a opção está ativa ou quando
 * ninguém ainda se cadastrou. Em caso de falha, recusa o acesso: se o banco de
 * dados não responder, ninguém novo entra.
 */
export async function signupIsOpen(db: ServiceDb = createServiceClient()): Promise<boolean> {
  if (openSignup()) return true
  const { data, error } = await db.rpc('install_has_account')
  if (error) {
    console.error('signupIsOpen: não foi possível ler as contas da instalação', error.message)
    return false
  }
  return data === false
}

/**
 * Após a autenticação: esta conta pode usar a instalação? Registra a primeira
 * conta como responsável. TRUE = admitida, FALSE = recusada, NULL quando o
 * Supabase retorna um usuário provisório para um endereço que já existe.
 *
 * Gera um erro quando o banco de dados não consegue responder. Assim, quem
 * chama recusa a sessão, mas pode pedir que a pessoa tente novamente em vez de
 * informar que o cadastro está fechado.
 */
export async function admitAccount(
  userId: string,
  db: ServiceDb = createServiceClient(),
): Promise<boolean | null> {
  const { data, error } = await db.rpc('admit_install_account', {
    p_user_id: userId,
    p_open: openSignup(),
  })
  if (error) {
    console.error('admitAccount: não foi possível tomar uma decisão', error.message)
    throw new Error('admitAccount: não foi possível verificar o acesso')
  }
  return data
}
