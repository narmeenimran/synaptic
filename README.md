# Synaptic

Synaptic is an AI-assisted study workspace designed to transform text-based PDFs into active-recall flashcards, automate spaced repetition scheduling, and power adaptive study quizzes grounded directly in your saved study material.

# Core Capabilities

1. Automated PDF Parsing & Deck Generation: Upload text-based PDFs (up to 10 MB, processed entirely in memory without server storage) to generate flashcard decks of up to 20 cards.

2. Resilient Card Generation: Deck generation uses time-limited AI requests with a bounded source-text prompt. Limited follow-up requests fill missing cards; if AI is unavailable or still returns too few, remaining cards are created from the study material.

3. Cognitive Spaced Repetition (SRS): Study active due cards or restart full deck reviews using standard SuperMemo-based confidence ratings (Again, Hard, Good, Easy).

4. Grounded Multiple-Choice Quizzes: Practice with dynamically generated 5-question quizzes built directly from deck content. Includes step-by-step hints for incorrect choices and direct source-card attribution.

5. Weakness Hunter Quizzes: Generate targeted mini-quizzes from up to three low-confidence cards to reinforce problem areas.

6. Interactive AI Assistant & Streaming Explanations: Access low-latency AI explanations and contextual follow-up guidance in an interactive side panel.

7. Real-Time Web Context (Tavily Integration): Optionally incorporate live web search context during deck creation or card verification to supplement static source material.

8. Speech Recognition & Text-to-Speech: Review cards using built-in text-to-speech audio or speak answers aloud via browser speech recognition for active recall.

9. Data Mobility: Export complete card decks to standard CSV format at any time.

10. Gamification & Profile Customization: Track total card reviews, earn XP, unlock level milestones, and upload custom profile avatars (PNG/JPG up to 5 MB).

# Environment Requirements

Node.js (v18+) and npm

A Supabase project with Email/Password authentication enabled

A Nebius API key (powering AI card generation, adaptive quizzes, and side-panel explanations)

A Tavily API key (optional; required only for real-time web verification features)

# Local Setup

Install dependencies:

npm install


Configure Environment Variables:
Create a .env file in the project root:

PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
NEBIUS_API_KEY=your-nebius-api-key

# Configuration Defaults:
# NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
# NEBIUS_MODEL=nvidia/Nemotron-3_5-Lightning
# TAVILY_API_KEY=your-tavily-api-key


Note: SUPABASE_PUBLISHABLE_KEY may be used in place of SUPABASE_ANON_KEY. Keep secret provider keys securely stored in your server-side environment.

Database & Storage Migrations:
Apply the following SQL files in sequence inside your Supabase SQL Editor:

supabase/migrations/202610260001_synapse_study_workspace.sql — Establishes user profiles, decks, cards, review logs, and Row-Level Security (RLS) policies.

supabase/migrations/202610260002_synapse_starter_decks.sql — Initializes starter deck tracking flags.

supabase/migrations/202610260003_synaptic_avatars.sql — Configures the avatar Storage bucket and access permissions.

Newly created accounts automatically receive three curated starter decks (Cell Biology, AI Applications, and Solar System Astronomy). Custom profile avatar uploads are isolated securely to each authenticated user's bucket folder.

Authentication Setup:
Enabling Email/Password authentication within your Supabase dashboard is optional. Configure email confirmation requirements according to your project settings.

Launch the Application:

npm start


Access the workspace locally at http://localhost:3000.

Automated Testing

Execute the native Node.js test suite:

npm test


The test suite validates flashcard generation boundaries, quiz schema validation, starter deck seeding routines, and SRS scheduling algorithms. (Note: Unit tests operate independently of live Supabase database connections or external AI service availability).

Deployment

Synaptic includes a pre-configured vercel.json file for serverless deployment on Vercel. Ensure all environment variables are properly populated in your cloud dashboard, database migrations are applied to production Supabase, and authentication and storage permissions are thoroughly verified post-deployment.

# License

Distributed under the Mozilla Public License 2.0. See `LICENSE` for more details.

Thank you for checking out Synaptic. I hope this workspace makes your learning and study sessions effortless!