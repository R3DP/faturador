// SOMENTE NO SERVIDOR. Ignora RLS. Chamadas autorizadas:
// src/lib/api-keys/resolver.ts e src/lib/mcp/scoped-db.ts (a camada de dados
// com escopo obrigatório; todo outro acesso autenticado por chave de API,
// inclusive /api/v1/me, deve passar por ScopedDb).
// src/app/api/stripe/payment-intent/route.ts - a pessoa pagadora anônima em uma
// página pública de fatura não tem sessão. Lê e grava somente a linha da fatura
// identificada pelo próprio public_id da fatura, nunca por um ID fornecido por
// quem chama; também lê a linha de pagamento dessa fatura para obter o PaymentIntent anterior.
// src/app/api/stripe/webhook/route.ts - o webhook Stripe não tem sessão de usuário.
// Grava linhas em stripe_events (livro-razão de idempotência), payments e invoices,
// identificadas somente por IDs fornecidos pela Stripe (metadados do evento,
// ID payment_intent), depois de verificar a assinatura Stripe da requisição.
// src/lib/rate-limit.ts - os contadores persistentes de limite de requisições
// ficam em uma tabela protegida por RLS e sem políticas; o limitador precisa
// funcionar antes da existência de qualquer sessão (login, cadastro, links
// públicos de pagamento anônimos). Chama somente consume_rate_limit /
// peek_rate_limit, que recebem uma chave opaca de bucket em hash e retornam
// três inteiros referentes somente a essa chave.
// src/lib/oauth/store.ts - os endpoints OAuth são executados sem sessão por
// definição: /api/oauth/register e /api/oauth/token são chamados por um processo
// de agente que ainda não iniciou sessão, e oauth_clients /
// oauth_authorization_codes / oauth_refresh_tokens são protegidas por RLS e
// não têm políticas, pois armazenam credenciais que nenhum navegador pode ler.
// Todas essas consultas ficam nesse único módulo; a visualização das próprias
// conexões por uma pessoa autenticada passa por src/lib/oauth/connections.ts,
// usando seu próprio cliente.
// src/lib/auth/admission.ts - o cadastro é encerrado após a primeira conta. A
// tabela install_accounts e suas duas funções são exclusivas da service role,
// para que nenhum navegador possa se cadastrar por conta própria; o módulo
// chama somente install_has_account e admit_install_account, cada uma referente
// a no máximo um ID de usuário.
// Não adicione chamadas sem uma revisão que justifique a necessidade.
import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export function createServiceClient() {
  return createClient<Database>(
    (process.env.SUPABASE_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}
