import Link from "next/link";

export function RecentInvoices({ invoices }: { invoices: any[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Faturas Recentes</h3>
        <Link
          href="/invoices"
          className="text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
        >
          Ver todas &rarr;
        </Link>
      </div>
      <div className="p-6">
        {invoices.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhuma fatura encontrada.</p>
        ) : (
          <div className="space-y-4">
            {/* Lista de faturas */}
          </div>
        )}
      </div>
    </div>
  );
}
