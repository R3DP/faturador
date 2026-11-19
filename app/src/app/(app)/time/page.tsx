import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { PlusIcon } from "@heroicons/react/24/outline";

export default async function TimePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Horas e Despesas"
          description="Registro de horas trabalhadas e despesas faturáveis para clientes."
        />
        <Link
          href="/time/new"
          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon className="h-4 w-4" />
          Registrar Horas
        </Link>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum registro de tempo ou despesa encontrado.</p>
      </div>
    </div>
  );
}
