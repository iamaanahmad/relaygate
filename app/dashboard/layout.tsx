'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  KeyRound,
  PlugZap,
  GitBranch,
  ScrollText,
  Settings,
  Loader2,
  LogOut,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/dashboard/providers', label: 'Providers', icon: PlugZap },
  { href: '/dashboard/routing', label: 'Routing', icon: GitBranch },
  { href: '/dashboard/logs', label: 'Logs', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

function GatewayMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    </span>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading, signOut } = useAuth();
  const {
    workspace,
    projects,
    project,
    setProjectId,
    loading: wsLoading,
  } = useWorkspace();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/signin');
  }, [authLoading, user, router]);

  if (authLoading || wsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0f1a] text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-slate-100">
      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6 lg:px-8">
        <aside className="hidden w-56 shrink-0 flex-col md:flex">
          <Link href="/" className="mb-8 flex items-center gap-2 font-semibold tracking-tight text-white">
            <GatewayMark />
            Relay<span className="-ml-2 text-emerald-400">Gate</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                    active
                      ? 'bg-emerald-500/10 font-medium text-emerald-300'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => signOut()}
            className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-800/50 hover:text-slate-300"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 pb-16">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold text-white">
              {workspace ? workspace.name : 'RelayGate'}
            </h1>
            {projects.length > 0 && (
              <select
                value={project?.id ?? ''}
                onChange={(e) => setProjectId(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#0d1524] px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                aria-label="Select project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="md:hidden">
            <nav className="mb-6 flex flex-wrap gap-2">
              {NAV.map((item) => {
                const active =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs',
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-700 text-slate-400'
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
