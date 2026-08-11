# Deployment boundaries

Feature branches target `development`. Each PR must pass hosted CI and its Development preview before merge. `development` is not Production, and a ready deployment is not proof that the intended alias, environment variables, database history, or authenticated journeys are correct.

Promotion from `development` to `main` is a separate release operation. It requires explicit authorization and Production-specific migration, provider, and browser checks. Repository cleanup does not authorize Production database mutation, alias reassignment, or release claims.

Supabase changes follow [the deployment workflow](supabase-deployment.md). Private-plugin changes follow [the two-repository workflow](private-plugins.md).
