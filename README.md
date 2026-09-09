# Extension Pulse v1.0

A program evaluation platform for university extension offices. Extension Pulse helps teams collect data from staff and community partners via token-gated forms, review submissions, generate AI-assisted summaries and narratives, and produce reports — all organized around grant award periods.

Built with [Next.js](https://nextjs.org), [Supabase](https://supabase.com), and [Claude](https://anthropic.com).

---

## Features

- **Multi-program support** — one deployment, multiple programs, role-based access per program
- **Token-gated forms** — invite respondents by email; no account required to fill out a form
- **Drag-and-drop form builder** — multi-page forms with sections, conditional logic, and file attachments
- **Submission review** — flag submissions, send feedback, delegate sections to collaborators
- **AI summaries** — Claude-powered narrative summaries of submission data
- **Award context** — upload grant narratives, logic models, and progress reports as grounding for AI features
- **Pulse notes** — qualitative field notes with file attachments, imported from Google Docs
- **Reports** — rich-text reports built from submission data, exportable to PDF
- **Audit log** — full trail of admin actions

---

## Prerequisites

- [Node.js](https://nodejs.org) 20 or later
- [Supabase](https://supabase.com) account (free tier works for development)
- [Supabase CLI](https://supabase.com/docs/guides/cli) for database migrations
- [Anthropic API key](https://console.anthropic.com) for AI features (optional but recommended)
- An email provider — Mailgun, Resend, SMTP, or console logging for local dev

---

## Local development setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/your-org/extension-pulse.git
cd extension-pulse
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish provisioning
3. Go to **Project Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in at minimum:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (use `http://localhost:3000` for local dev)

See `.env.example` for all options including email providers and AI.

### 4. Run database migrations

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Your project ref is the part of your Supabase URL after `https://` and before `.supabase.co`.

### 5. Configure Supabase Auth

In your Supabase dashboard:

1. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/auth/callback`

2. **Authentication → Email Templates** (optional but recommended)
   - Disable the default Supabase invite email — Extension Pulse sends its own via your configured email provider

### 6. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to the login page.

### 7. Create your first admin user

In your Supabase dashboard go to **Authentication → Users** and click **Add user → Create new user**. Use your email address. Then in the **Table Editor** open `program_memberships` and insert a row with your user ID and `role = 'super_admin'` (you'll need to create a program first, or set `program_id` to any UUID you intend to use).

Alternatively, use the Supabase SQL editor:

```sql
-- After signing up, run this to make yourself a super admin for all programs
UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}' WHERE email = 'you@yourinstitution.edu';
```

---

## Production deployment

### Vercel + Supabase (recommended)

This is the same stack the project was developed on. Both have generous free tiers.

1. Push your code to GitHub (or GitLab/Bitbucket)
2. Import the repository at [vercel.com/new](https://vercel.com/new)
3. Add all environment variables from `.env.example` in the Vercel project settings
4. Deploy

For the Supabase project used in production:
- In **Authentication → URL Configuration**, set Site URL and add your production domain to Redirect URLs
- Run `npx supabase db push` with the production project linked

### Other platforms

Any platform that runs Next.js server-side rendering will work (Railway, Render, Fly.io, self-hosted). Set the environment variables and ensure:
- The server can reach the Supabase project URL
- `NEXT_PUBLIC_APP_URL` is set to your public domain

---

## Email setup

Set `EMAIL_PROVIDER` in your environment to one of:

| Provider | Description |
|---|---|
| `console` | Logs emails to stdout — default, great for local dev |
| `mailgun` | [Mailgun](https://mailgun.com) — reliable, EU-friendly |
| `resend` | [Resend](https://resend.com) — modern API, excellent deliverability |
| `smtp` | Any SMTP server — SendGrid, AWS SES, Postfix, etc. |

See `.env.example` for the specific variables each provider requires.

> **Important:** Supabase sends its own auth emails (magic links, password resets) separately from Extension Pulse's email system. Make sure Supabase's SMTP is also configured in **Project Settings → Auth → SMTP Settings** if you want branded auth emails.

---

## AI features

AI features require an `ANTHROPIC_API_KEY`. If the key is not set, the AI features gracefully degrade:
- AI summary generation will return an error to the user
- The Sidekick assistant will be unavailable
- Award context documents can still be uploaded and will appear in the UI

All AI calls use [Claude](https://anthropic.com/claude). The model used is `claude-sonnet-4-6` by default. You can change this in `src/app/api/ai/`.

---

## Database migrations

Schema changes are managed with the Supabase CLI:

```bash
# Create a new migration
npx supabase migration new your_migration_name

# Apply pending migrations to the linked project
npx supabase db push

# Reset local database to match migrations (destructive)
npx supabase db reset
```

Migrations live in `supabase/migrations/`. Never edit existing migration files — always add new ones.

---

## Project structure

```
src/
  app/
    (app)/          # Authenticated admin area (sidebar layout)
    f/[slug]/       # Public token-gated form renderer
    my/             # Respondent portal (no program membership required)
    auth/           # Login, callback, password reset
    api/            # All API routes (mutations)
  lib/
    supabase/       # createClient() and createServiceClient() helpers
    email.ts        # Multi-provider email abstraction
    audit.ts        # Audit log helper
  contexts/
    program-context.tsx   # Current program + role, shared across the admin UI
  types/
    forms.ts        # FormSchema, FormField, FormSettings types
    database.ts     # Generated Supabase types
supabase/
  migrations/       # SQL migration files
```

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

---

## License

MIT — see [LICENSE](LICENSE).
