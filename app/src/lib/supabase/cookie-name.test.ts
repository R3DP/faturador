import { expect, it } from 'vitest'
import { authCookieName } from './cookie-name'
it('usa a identidade da API pública mesmo quando o servidor tem uma URL interna', () => {
  expect(authCookieName('https://example.supabase.co')).toBe(
    'sb-example-auth-token',
  )
  expect(authCookieName('http://127.0.0.1:57421')).toBe('sb-127-auth-token')
  expect(authCookieName('http://host.docker.internal:57421')).not.toBe(
    authCookieName('http://127.0.0.1:57421'),
  )
})
