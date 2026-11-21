'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { workspaceNavigation } from './sidebar'

const detailNames: Record<string, string> = {
  new: 'Criar novo',
  edit: 'Editar',
  business: 'Empresa',
  account: 'Conta',
  branding: 'Identidade visual',
  invoices: 'Padrões de fatura',
}
export function WorkspaceHeader() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const page = workspaceNavigation
    .flatMap((g) => g.items)
    .find((item) => item.href === `/${segments[0]}`)
  if (!page) return null
  return (
    <div className="hidden h-14 shrink-0 items-center justify-between border-b border-border px-8 lg:flex">
      <nav aria-label="Caminho de navegação" className="flex items-center gap-2 text-xs">
        <page.icon size={14} className="text-muted-foreground" />
        <Link href={page.href} className="text-muted-foreground hover:text-primary">
          {page.label}
        </Link>
        {segments.slice(1).map((part, index) => (
          <span key={index} className="flex items-center gap-2">
            <ChevronRight size={12} className="text-muted-foreground" />
            <span className="text-foreground">
              {detailNames[part] || 'Detalhes'}
            </span>
          </span>
        ))}
      </nav>
      <span className="text-[11px] text-muted-foreground">Seu espaço de trabalho de cobrança</span>
    </div>
  )
}
