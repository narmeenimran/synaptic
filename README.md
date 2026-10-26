# Synapse AI

Synapse is an AI-assisted spaced-repetition workspace. It turns text-based PDFs into flashcards, schedules reviews, records confidence, and generates focused quizzes from cards that need more practice.

## Run locally

1. Install the dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in the Supabase URL/public anon key, Nebius API key, and (optionally) Tavily API key.
3. In the Supabase SQL Editor, run [`supabase/migrations/202610260001_synapse_study_workspace.sql`](./supabase/migrations/202610260001_synapse_study_workspace.sql).
4. Enable email/password sign-in in Supabase Authentication.
5. Start the app with `npm start` and open `http://localhost:3000`.

The anon key is public client configuration; Nebius and Tavily keys stay server-side. Never put a Supabase service-role key in the browser or commit `.env`.

## Study workflow

- Create a deck from a text-based PDF. PDF uploads are processed in memory and are not stored.
- Reopen any saved deck from the dashboard or library and study all its cards again at any time, whether or not they are currently due.
- Review due cards and rate recall as Again, Hard, Good, or Easy.
- Review history and card schedules are stored per account; row-level security protects each user's profile, decks, cards, and reviews.
- Open concise AI explanations in a docked side panel while keeping the current study card visible.
- Use the Weak Spots view to revisit low-mastery cards and generate a short AI quiz.
- Use live research only when Tavily is configured; AI explanations and card generation require Nebius.

The Supabase migration is required before signing in to the study workspace. If an integration key is missing or a provider is unavailable, the app reports that explicitly instead of pretending the feature succeeded.

## AI generation troubleshooting

- Keep the terminal running `npm start` open while generating cards; provider diagnostics are written there.
- If generation is rejected, the app reports common Nebius causes such as an invalid key, unavailable model, rate limit, or oversized request. Check the terminal for the provider's status and error detail, but never share or publish `.env` values.
- After changing `.env`, restart the server. If a request fails with HTTP 400, try shorter study material or a smaller card count.

## Checks

- `npm test` runs the focused scheduling tests.
- `node --check server.js` and `node --check src/api.js` validate server JavaScript syntax.
