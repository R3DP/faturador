/**
 * O que cada ação de gravação chamada pelo navegador retorna.
 *
 * Essas ações são chamadas por componentes de cliente que já exibem uma
 * notificação em caso de falha; por isso, retornam um valor em vez de lançar
 * uma exceção através do limite da server action. Uma exceção chega ao
 * navegador como um identificador opaco, sem informar nada útil à pessoa.
 */
export type WriteResult = { ok: true } | { error: string }

/** Reduz uma falha desconhecida a uma mensagem útil para exibição. */
export function failure(error: unknown, fallback: string): WriteResult {
  return { error: error instanceof Error ? error.message : fallback }
}
