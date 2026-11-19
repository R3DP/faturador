import Link from "next/link";
import { PlusIcon, UserPlusIcon, ClockIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/invoices/new"
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <PlusIcon className="h-4 w-4" />
        Nova Fatura
      </Link>
      <Link
        href="/estimates/new"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <DocumentTextIcon className="h-4 w-4" />
        Novo Orçamento
      </Link>
      <Link
        href="/clients/new"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <UserPlusIcon className="h-4 w-4" />
        Novo Cliente
      </Link>
      <Link
        href="/time/new"
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <ClockIcon className="h-4 w-4" />
        Registrar Horas
      </Link>
    </div>
  );
}
