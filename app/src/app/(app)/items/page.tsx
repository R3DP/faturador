'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Package, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { useBusiness } from '@/lib/hooks/use-business'
import type { Item } from '@/types'

import { deleteItemAction } from '@/lib/actions/items'
import { toast } from 'sonner'

export default function ItemsPage() {
  const { currentBusiness } = useBusiness()
  const [items, setItems] = useState<Item[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteItem, setDeleteItem] = useState<Item | null>(null)

  useEffect(() => {
    async function fetchItems() {
      if (!currentBusiness) return

      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const { data } = await supabase
        .from('items')
        .select('*')
        .eq('business_id', currentBusiness.id)
        .order('name')

      if (data) {
        setItems(data as Item[])
      }
      setIsLoading(false)
    }

    fetchItems()
  }, [currentBusiness])

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currentBusiness?.default_currency || 'USD',
    }).format(amount)
  }

  const handleDelete = async () => {
    if (!deleteItem) return

    const result = await deleteItemAction(deleteItem.id)
    if ('error' in result) {
      toast.error(result.error)
      setDeleteItem(null)
      return
    }
    setItems(items.filter(i => i.id !== deleteItem.id))
    setDeleteItem(null)
  }

  if (!currentBusiness) return null

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Itens"
        description="Gerencie seu catálogo de produtos e serviços"
      >
        <Button asChild>
          <Link href="/items/new">
            <Plus className="mr-2 h-4 w-4" />
            Adicionar item
          </Link>
        </Button>
      </PageHeader>

      {/* Busca */}
      <div className="mt-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar itens..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Tabela de itens */}
      <div className="mt-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredItems.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Package}
                title={searchQuery ? 'Nenhum item encontrado' : 'Nenhum item cadastrado'}
                description={
                  searchQuery
                    ? 'Tente outro termo de busca'
                    : 'Cadastre itens reutilizáveis para adicioná-los rapidamente a faturas e orçamentos'
                }
                action={
                  !searchQuery
                    ? { label: 'Adicionar item', href: '/items/new' }
                    : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link
                          href={`/items/${item.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {item.name}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {item.description || '-'}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatCurrency(item.rate)}
                      </TableCell>
                      <TableCell>
                        {item.unit ? (
                          <Badge variant="secondary">{item.unit}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/items/${item.id}`}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Editar
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDeleteItem(item)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Diálogo de confirmação de exclusão */}
      <Dialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir item</DialogTitle>
            <DialogDescription>
              Tem certeza de que deseja excluir &quot;{deleteItem?.name}&quot;? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItem(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

