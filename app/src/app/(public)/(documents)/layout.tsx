import type { Metadata } from 'next'

// Os documentos públicos de fatura e orçamento usam IDs impossíveis de adivinhar e não devem
// ser indexados por mecanismos de busca.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-muted/30">
      {children}
    </div>
  )
}

