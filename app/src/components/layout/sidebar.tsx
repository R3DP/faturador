import Link from "next/link";
import {
  HomeIcon,
  DocumentTextIcon,
  UserGroupIcon,
  ClockIcon,
  CreditCardIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  BriefcaseIcon,
  DocumentDuplicateIcon,
} from "@heroicons/react/24/outline";

const navigation = [
  { name: "Início", href: "/", icon: HomeIcon },
  { name: "Faturas", href: "/invoices", icon: DocumentTextIcon },
  { name: "Orçamentos", href: "/estimates", icon: DocumentDuplicateIcon },
  { name: "Compromissos", href: "/engagements", icon: BriefcaseIcon },
  { name: "Clientes", href: "/clients", icon: UserGroupIcon },
  { name: "Horas e Despesas", href: "/time", icon: ClockIcon },
  { name: "Pagamentos", href: "/payments", icon: CreditCardIcon },
  { name: "Relatórios", href: "/reports", icon: ChartBarIcon },
  { name: "Configurações", href: "/settings", icon: Cog6ToothIcon },
];

export function Sidebar() {
  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-zinc-200 lg:bg-zinc-50 lg:dark:border-zinc-800 lg:dark:bg-zinc-950">
      <div className="flex h-16 items-center px-6 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Faturador</span>
      </div>
      <nav className="flex-1 space-y-1 px-4 py-4">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <item.icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            {item.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
