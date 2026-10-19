# RelayGate — AI Reliability Gateway

RelayGate is a production-ready AI reliability gateway: teams register their own AI provider credentials (OpenAI, Anthropic, Gemini) in encrypted form, configure per-project failover chains, and call a single AI endpoint that walks the chain until a provider succeeds — logging every attempt without ever storing prompt payloads or secrets.

## Features

- Single AI endpoint with bounded, ordered failover across OpenAI, Anthropic, and Gemini
- Encrypted credential storage (AES-256-GCM) that only server-side functions can read
- Gateway API keys stored as one-way SHA-256 hashes; plaintext shown once at creation
- Workspace/team model with roles (owner/admin/developer/viewer) enforced server-side
- Per-key rate limiting (120 req/min) and concurrency limits (5 per key) in the gateway
- Request logging with token usage and failover trails — never prompt/response payloads
- Dark, responsive dashboard for projects, keys, routing, providers, and logs

## Architecture

- **Frontend/dashboard**: Next.js 13 (app router), Tailwind CSS, shadcn/ui, Lucide icons
- **Backend**: Supabase (Postgres + auth + edge functions in Deno)
- **Deployment**: Netlify (dashboard) + Supabase (backend)

```
app/                 Next.js app router pages (dashboard, signin, signup, settings)
components/ui/       shadcn/ui components
hooks/               Shared React hooks (toast)
lib/                 Supabase client, edge-function client, contexts, types
supabase/
  migrations/       Postgres schema + RLS policies (3 migrations)
  functions/        Deno edge functions (gateway, api-keys, provider-keys, members, bootstrap-workspace)
```

## Quick start

### Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- A Netlify account for deployment (optional for local dev)

### 1. Clone and install

```bash
git clone <repo-url> relaygate
cd relaygate
npm install
```

### 2. Create a Supabase project

1. Go to https://supabase.com/dashboard and create a new project
2. When the project is ready, copy the **Project URL** and **anon public key** from Project Settings → API

### 3. Run the database migrations

Apply the 3 migrations in order from Project Settings → Database → Migrations, or with the Supabase MCP tools if available. They create the schema, RLS policies, and the private `gateway_secrets` row.

### 4. Deploy the edge functions

Use the Supabase MCP tools to deploy every function under `supabase/functions/` (api-keys, bootstrap-workspace, gateway, members, provider-keys). Secrets are automatically configured.

### 5. Configure environment

```bash
cp .env.example .env
# Edit .env with your Supabase URL and anon key
```

### 6. Run locally

```bash
npm run dev
```

Then open the printed local URL, create an account on the sign-up page, and bootstrap a workspace when prompted. The dashboard walks you through creating a project, adding a provider key, and configuring routing.

## Calling the gateway

Once a project has routing rules and provider credentials:

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/gateway" \
  -H "Authorization: Bearer gw_your_gateway_key" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "<uuid>",
    "model_alias": "chat-basic",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Response: AI content, which provider/model actually answered, token usage, the failover trail, and latency.

## Documentation

- **Backend setup guide**: [docs/BACKEND_SETUP.md](docs/BACKEND_SETUP.md)
- **GitHub preparation guide**: [docs/GITHUB_PREP.md](docs/GITHUB_PREP.md)

## Beta limitations

- Streaming responses are not supported; failover is impossible mid-stream because a provider that has already sent bytes cannot be retried transparently
- Rate limits are per-edge-function-instance, not global; exact global ceilings depend on edge runtime behavior
- One workspace per user in the first release
