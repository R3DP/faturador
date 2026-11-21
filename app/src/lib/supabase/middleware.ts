import { authCookieName } from './cookie-name'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_ROUTES = [
  '/dashboard',
  '/invoices',
  '/estimates',
  '/engagements',
  '/clients',
  '/items',
  '/time',
  '/expenses',
  '/payments',
  '/reports',
  '/settings',
  '/onboarding',
  '/agents',
  '/tasks',
]
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password']

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: authCookieName(process.env.NEXT_PUBLIC_SUPABASE_URL!),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANTE: Não inclua nenhuma lógica entre createServerClient e
  // supabase.auth.getUser(). Um erro simples poderia dificultar muito a análise
  // de problemas que desconectem usuários aleatoriamente.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route))

  /** Redirecionamento que mantém os cookies de autenticação atualizados acima. */
  function redirectTo(url: URL) {
    const response = NextResponse.redirect(url)
    for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie)
    return response
  }

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // Não há página inicial: "/" abre o espaço de trabalho ou, se a pessoa não estiver autenticada, o login.
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = user ? '/dashboard' : '/login'
    url.search = ''
    return redirectTo(url)
  }

  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    const redirect = request.nextUrl.searchParams.get('redirect')
    url.pathname = redirect || '/dashboard'
    url.searchParams.delete('redirect')
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
