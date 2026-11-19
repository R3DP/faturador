import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { PlusIcon } from "@heroicons/react/24/outline";

export default async function EstimatesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Orçamentos"
          description="Gerencie propostas e orçamentos enviados aos clientes."
        />
        <Link
          href="/estimates/new"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon className="h-4 w-4" />
          Novo Orçamento
        </Link>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum orçamento cadastrado.</p>
      </div>
    </div>
  );
}
