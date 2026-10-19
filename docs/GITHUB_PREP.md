# Preparing RelayGate for GitHub

Steps to take this project from a Bolt workspace to a clean GitHub repository.

## 1. Files to keep out of the repo (already handled)

`.gitignore` excludes: `node_modules`, `.next`, `.env`, `.env*.local`, `next-env.d.ts`, build output, and debug logs. Verify before the first push:

```bash
git status
```

If `.env` shows up in the list of files to be committed, do not push — the Supabase anon key must come from repository secrets, not the repo.

## 2. Create the repository

```bash
git init
git add .
git commit -m "Initial import: RelayGate AI reliability gateway"
# Create an empty repo on github.com, then:
git remote add origin git@github.com:<you>/relaygate.git
git push -u origin main
```

## 3. Environment variables for CI/deployment

Set these as repository/deploy-environment secrets (never commit them):

| Name | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |

Netlify: Site configuration → Environment variables. The `netlify.toml` in the repo already wires the build command and the Next.js plugin.

## 4. Suggested repo polish

- Add branch protection on `main` (require a passing build before merge)
- Add topics/description on GitHub (ai-gateway, supabase, nextjs)
- Consider adding a LICENSE before making the repo public
- Link the repo to Netlify for automatic deploys on push

## 5. Pre-push checklist

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `.env` is NOT in the commit (`git ls-files | grep ^\.env$` returns nothing)
- [ ] `.env.example` is committed (contains placeholder values only)
- [ ] `README.md`, `docs/BACKEND_SETUP.md`, `docs/GITHUB_PREP.md` committed
