import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { PlusIcon } from "@heroicons/react/24/outline";

export default async function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Faturas"
          description="Gerencie e acompanhe o status de todas as faturas emitidas."
        />
        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon className="h-4 w-4" />
          Nova Fatura
        </Link>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhuma fatura cadastrada.</p>
      </div>
    </div>
  );
}
