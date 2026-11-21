/** Mantenha iguais as identidades dos cookies no navegador e no servidor quando o Docker usar uma URL interna da API. */
export function authCookieName(publicUrl: string): string {
  // Corresponde ao nome de cookie padrão do supabase-js, mantendo válidas as sessões existentes.
  return `sb-${new URL(publicUrl).hostname.split('.')[0]}-auth-token`
}
