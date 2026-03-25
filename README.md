# Let's Assist

Let's Assist is a comprehensive online volunteering platform that helps organizations and high school CSF programs manage, automatically track, and coordinate volunteering activities for students and communities. It simplifies the process for organizations to create and manage volunteer events, track student contributions, and verify hours securely using QR codes.

Try it out at [lets-assist.com](https://lets-assist.com/)

## Video Demo

<https://github.com/user-attachments/assets/e4e3fcae-33c7-4de5-8aa9-8e502911abf1>

## Tech Stack

This project is built using the following technologies:

- [Next.js](https://nextjs.org/): React framework for SSR and static site generation.
- [Vercel](https://vercel.com/): Cloud platform for deployment and hosting.
- [Tailwind CSS](https://tailwindcss.com/): Utility-first CSS framework for rapid UI development.
- [PostHog](https://posthog.com/): Open-source product analytics platform.
- [shadcn/ui](https://ui.shadcn.com/): Reusable components built with Base UI and Tailwind CSS.
- [Supabase](https://supabase.com/): Open-source Firebase alternative with PostgreSQL database.
- [Catpuccin](https://catppuccin.com/): Soothing color palette for consistent theming.
- [Cloudflare](https://www.cloudflare.com/): Security, domain and performance optimization.
And many other libraries...

## Local Supabase Development

If you want to stop developing directly against production and run everything locally:

- Copy environment template values into your local env file.

  Use `.env.example` as the source of truth and fill local Supabase keys from `npm run supabase:status`.

- Start local Supabase services.

  `npm run supabase:start`

- Refresh baseline schema snapshot from linked remote DB.

  `npm run supabase:dump:schema`

- Refresh local seed data snapshot from linked remote DB.

  `npm run supabase:dump:seed`

  Review/sanitize `supabase/seed.sql` before committing.

- Rebuild local DB from migrations and seed.

  This repository currently uses a **baseline bootstrap mode** in `supabase/config.toml`:

  - historical migrations are skipped for local reset
  - baseline schema SQL + `seed.sql` are loaded during reset

  `npm run supabase:reset`

- Start the app.

  `npm run dev`

### Google Auth + Google Calendar locally

This app uses two Google OAuth paths:

- **Supabase Auth Google login/signup** (`supabase.auth.signInWithOAuth`)
- **Google Calendar OAuth** (`/api/calendar/google/*` routes)

To make both work locally:

- In Google Cloud Console OAuth client settings, add redirect URLs:

  - `http://localhost:3000/auth/callback`
  - `http://localhost:3000/api/calendar/google/callback`
  - `http://127.0.0.1:54321/auth/v1/callback`

- Set these env vars in your local app env (`.env.local`):

  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI=http://localhost:3000/api/calendar/google/callback`

- Add Supabase-auth-specific Google vars to `supabase/.env.local` (see `supabase/.env.local.example`):

  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback`

- In `supabase/config.toml`, set `[auth.external.google] enabled = true` for local auth provider testing.

- Restart Supabase services after config/env changes:

  ```bash
  bun run supabase:stop
  bun run supabase:start
  ```

### Useful Local Scripts

```bash
bun run supabase:start          # Start Supabase containers
bun run supabase:stop           # Stop containers
bun run supabase:status         # Check status
bun run supabase:reset          # Reset to baseline + seed
bun run supabase:dump:schema    # Pull remote schema to baseline
bun run supabase:dump:seed      # Pull seed data from remote
```

### About OPENAI_API_KEY in supabase/.env.local

The `OPENAI_API_KEY` in `supabase/.env.local` is a placeholder for future AI features. It's not currently used. Set it to a real key if integrating AI features, or leave as-is for development.

## CI/CD Pipeline

This project uses **GitHub Actions** for automated testing. See [.github/workflows/ci.yml](.github/workflows/ci.yml).

### What CI Validates

On every PR:

```bash
bun run lint              # ESLint checks
bun run typecheck         # TypeScript type checking
bun run test              # Vitest unit/integration tests
bun run supabase:reset    # (if DB files changed) Validates local reset works
```

### CI Does NOT Auto-Deploy

- ✅ CI validates code quality and schema changes are correct
- ❌ CI does NOT push to production
- 🔓 Manual `supabase db push --linked` required after PR merge

## Recommended Git + Release Workflow

Use this promotion path consistently:

1. Create `feature/*` branch from `development`
2. Open PR into `development`
3. CI validates (lint, typecheck, tests, DB reset)
4. After approval, merge to `development`
5. If schema changes: run `supabase db push --linked` manually
6. Open PR from `development` into `main`
7. Merge to `main` (triggers production deployment via Vercel)

### Minimum Checks Before Opening PR

```bash
bun run lint                    # Check for linting errors
bun run typecheck               # Check TypeScript
bun run test                    # Run all tests
bun run supabase:reset          # (for DB changes) Verify local reset works
bun run dev                     # Manual smoke test in browser
```

### Local-to-remote DB promotion

This repository currently uses local baseline bootstrap mode (`[db.migrations].enabled = false`), so:

- `supabase db push --linked` will skip migrations while that mode is active.
- Keep using local baseline mode for feature development and reproducible resets.
- For production schema updates, run a controlled migration-promotion step (CI or deliberate local run) with migrations enabled for that run.

### CI/CD notes

- A PR quality workflow should run lint/typecheck/tests on PRs into `development` and `main`.
- DB-related PRs should additionally validate Supabase local replay (`supabase:start` + `supabase:reset`).
- Existing scheduled cron workflows should remain production-only and call deployed app endpoints.

## FAQ

<details>
  <summary>What was your inspiration for Let's Assist?</summary>
  <br>
  A: My inspiration for this project actually came from when I went to Santa Cruz Beach and saw a whole ton of trash, scatter all over the beach, and geese getting stuck in it. As I was cleaning up the trash, I thought why don't I make an application so that our whole community can help to clean up something, instead of individual contributions. After I found out about high school volunteering requirements, I knew I could enter a completely untapped market of volunteers to help in their community.
  <br>
  <img src="https://github.com/user-attachments/assets/2e59f1c1-4500-46b1-804f-b5347dfe0b32" alt="Santa Cruz Beach Cleanup" width="500">
</details>

<details>
<summary>I thought you said this was a solo project, who are the other contributors?</summary>
  <br>
A: This is a solo project. Essentially as I was in the creation stage of letsassist, I saw a hackathon and I asked my friends if they wanted to come together to help. We created an initial prototype and submitted that but after that the group disbanded. This was an extremely rough first sketch and after the hackathon I deleted all of it and restarted from scratch with a completely new tech stack, new look, redo, and this version is an actually real useable product, with 5 to 10 times more features than the previous one ever did (you can check commit history to confirm this)
<br>

[Before](https://youtu.be/OTF20YUN25U?si=5pVTplgBM3Kz02OR) and [After](https://lets-assist.com/)
<br>

  <div style="display: flex; justify-content: space-between;">
    <img src="https://github.com/user-attachments/assets/dc18a87f-fdf1-4334-aa61-cc4dd9f89098" alt="Before Prototype" width="300">
    <img src="https://github.com/user-attachments/assets/b51cc020-bd2c-4d58-bf9a-11edeecac453" alt="After Redo" width="300">
  </div>
</details>

<details>
  <summary>What makes Let's Assist any different from SignUpGenius?</summary>
  <br>
  A: I created Let’s Assist for two main reasons. First, I wanted an easy way to find and browse volunteering opportunities in my community. Second, I needed a fast, efficient way to track my hours across all projects. Let’s Assist solves both issues because platforms like SignUpGenius aren’t designed specifically for volunteering. By addressing these problems, Let’s Assist enhances the experience for thousands of high school volunteers and improves our community with a more meaningful impact.
</details>

<details>
    <summary>Are you looking to bring more people on board?</summary>
    <br>
    A: Let's Assist is a solo project and I am not looking to bring anyone on board at this time.
</details>

## License

This project is licensed under the [GPL-3.0 License](LICENSE)

## Contact

For questions or feedback, please contact [support@lets-assist.com](mailto:support@lets-assist.com).
