import Link from 'next/link';

const FEATURES = [
  {
    title: 'Automatic failover',
    body: 'When a provider rate-limits, times out, or goes down, requests walk your failover chain until one succeeds. Configure it once per model alias.',
  },
  {
    title: 'Bring your own keys',
    body: 'Connect your own OpenAI, Anthropic, and Google Gemini accounts. Keys are encrypted server-side and never exposed to the browser.',
  },
  {
    title: 'One OpenAI-compatible endpoint',
    body: 'Point your app at a single gateway URL with a gateway API key. Switch providers by editing routing rules, not code.',
  },
  {
    title: 'Production observability',
    body: 'Every request is logged with provider, latency, token usage, and the full failover trail. Payloads are never stored.',
  },
];

const CODE_SAMPLE = `curl https://your-gateway/functions/v1/gateway \\
  -H "Authorization: Bearer gw_..." \\
  -d '{
    "project_id": "...",
    "model_alias": "fast-chat",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1a] text-slate-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </span>
          RelayGate
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/signin" className="rounded-md px-3 py-2 text-slate-300 transition hover:text-white">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-emerald-500 px-4 py-2 font-medium text-[#06281f] transition hover:bg-emerald-400"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
          <p className="mb-4 inline-block rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            BYOK AI Reliability Gateway
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            One API. Multiple AI providers.
            <span className="block text-emerald-400">Automatic failover.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
            Connect your own OpenAI, Anthropic, and Gemini accounts. Route every request through
            one endpoint with a failover chain you control — so a provider outage never takes your
            product down.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-[#06281f] transition hover:bg-emerald-400"
            >
              Create your workspace
            </Link>
            <Link
              href="/signin"
              className="rounded-lg border border-slate-700 px-6 py-3 font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Sign in
            </Link>
          </div>

          <pre className="mx-auto mt-14 max-w-2xl overflow-x-auto rounded-xl border border-slate-800 bg-[#0d1524] p-5 text-left text-sm leading-relaxed text-slate-300">
            <code>{CODE_SAMPLE}</code>
          </pre>
        </section>

        <section className="border-t border-slate-800/60 bg-[#0c1220]">
          <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-[#0d1524] p-6">
                <h2 className="text-lg font-semibold text-white">{f.title}</h2>
                <p className="mt-2 leading-relaxed text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-slate-800/60">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-16 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Stay online when your provider isn&apos;t.
            </h2>
            <p className="max-w-xl text-slate-400">
              Set up a workspace, connect a provider key, and route your first request in minutes.
            </p>
            <Link
              href="/signup"
              className="mt-2 rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-[#06281f] transition hover:bg-emerald-400"
            >
              Get started free
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/60 py-8 text-center text-sm text-slate-500">
        RelayGate — AI reliability gateway. You pay providers directly for inference; RelayGate
        provides the routing layer.
      </footer>
    </div>
  );
}
