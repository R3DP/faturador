import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { PlusIcon } from "@heroicons/react/24/outline";

export default async function PaymentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Pagamentos"
          description="Acompanhe os pagamentos recebidos e conciliados."
        />
        <Link
          href="/payments/new"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon className="h-4 w-4" />
          Registrar Pagamento
        </Link>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum pagamento registrado.</p>
      </div>
    </div>
  );
}
