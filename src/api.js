import express from 'express';
import path from 'node:path';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';
import { generateFlashcards } from './flashcards.js';
import { calculateReviewSchedule } from './srs.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'application/pdf' || !file.originalname.toLowerCase().endsWith('.pdf')) {
      callback(null, false);
      return;
    }
    callback(null, true);
  }
});

const getSupabaseConfig = () => ({
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
});

const missingDatabaseSetupMessage = 'Synapse database tables are not ready. Apply the SQL migration in supabase/migrations before using the workspace.';

function databaseErrorMessage(error) {
  if (['42P01', 'PGRST205', 'PGRST200'].includes(error?.code)) {
    return missingDatabaseSetupMessage;
  }
  return error?.message || 'The database request failed.';
}

function sendDatabaseError(res, error) {
  const status = error?.code === '23505' ? 409 : 500;
  return res.status(status).json({ error: databaseErrorMessage(error) });
}

function validateText(value, label, minimum, maximum) {
  if (typeof value !== 'string') {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) {
    throw Object.assign(new Error(`${label} must be between ${minimum} and ${maximum} characters.`), { status: 400 });
  }
  return text;
}

function handleRouteError(res, error, label) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`${label}:`, error?.message || 'Unknown error');
  return res.status(500).json({ error: 'The request could not be completed. Please try again.' });
}

function createUserClient(accessToken) {
  const { url, anonKey } = getSupabaseConfig();
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
}

async function requireUser(req, res, next) {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return res.status(503).json({ error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.' });
  }

  const authorization = req.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }

  try {
    const authClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const { data, error } = await authClient.auth.getUser(tokenMatch[1]);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }

    req.user = data.user;
    req.db = createUserClient(tokenMatch[1]);
    return next();
  } catch (error) {
    console.error('Authentication request failed:', error?.message || 'Unknown error');
    return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
  }
}

function parseModelJson(content) {
  const clean = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start < 0 || end < start) {
    throw new Error('The AI response was not a JSON array.');
  }
  return JSON.parse(clean.slice(start, end + 1));
}

function getAiClient() {
  if (!process.env.NEBIUS_API_KEY) {
    throw Object.assign(new Error('NEBIUS_API_KEY is missing from .env.'), { status: 503 });
  }
  return new OpenAI({
    baseURL: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1/',
    apiKey: process.env.NEBIUS_API_KEY
  });
}

function getModel() {
  return process.env.NEBIUS_MODEL || 'nvidia/Nemotron-3_5-Lightning';
}

async function saveGeneratedDeck(req, { title, sourceType, sourceDetail, content, enableSearch, cardCount }) {
  const generated = await generateFlashcards(content, enableSearch, cardCount);
  const { data: deck, error: deckError } = await req.db
    .from('synapse_decks')
    .insert({
      title,
      source_type: sourceType,
      source_detail: sourceDetail
    })
    .select()
    .single();

  if (deckError) {
    throw Object.assign(new Error(databaseErrorMessage(deckError)), { status: 500 });
  }

  const cardRows = generated.map(card => ({
    deck_id: deck.id,
    question: card.question,
    answer: card.answer
  }));
  const { data: cards, error: cardsError } = await req.db
    .from('synapse_cards')
    .insert(cardRows)
    .select();

  if (cardsError) {
    const { error: cleanupError } = await req.db.from('synapse_decks').delete().eq('id', deck.id);
    if (cleanupError) {
      console.error('Could not remove incomplete generated deck:', cleanupError.message);
    }
    throw Object.assign(new Error(databaseErrorMessage(cardsError)), { status: 500 });
  }

  return { ...deck, cards };
}

router.get('/config', (_req, res) => {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    return res.status(503).json({ error: 'Set SUPABASE_URL and SUPABASE_ANON_KEY in .env to enable accounts.' });
  }
  return res.json({ supabaseUrl: url, supabaseAnonKey: anonKey });
});

router.use((req, res, next) => {
  if (req.path === '/config' || req.path === '/health') return next();
  return requireUser(req, res, next);
});

router.get('/profile', async (req, res) => {
  const { data, error } = await req.db
    .from('synapse_profiles')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return sendDatabaseError(res, error);
  if (!data) return res.status(404).json({ error: 'Your profile has not been created. Contact the workspace administrator.' });
  return res.json({ profile: data });
});

router.patch('/profile', async (req, res) => {
  try {
    const updates = {};
    if (Object.hasOwn(req.body, 'full_name')) {
      updates.full_name = validateText(req.body.full_name, 'Name', 1, 80);
    }
    if (Object.hasOwn(req.body, 'username')) {
      const username = validateText(req.body.username, 'Username', 3, 24).toLowerCase();
      if (!/^[a-z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Username may contain only letters, numbers, and underscores.' });
      }
      updates.username = username;
    }
    if (Object.hasOwn(req.body, 'birthday')) {
      const birthday = req.body.birthday;
      if (birthday !== null && (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday))) {
        return res.status(400).json({ error: 'Birthday must use YYYY-MM-DD format.' });
      }
      updates.birthday = birthday;
    }
    if (Object.hasOwn(req.body, 'avatar')) {
      const avatar = req.body.avatar;
      if (typeof avatar !== 'string' || avatar.length > 150000) {
        return res.status(400).json({ error: 'Choose a valid avatar image or emoji.' });
      }
      const isEmoji = avatar.length <= 32 && !/[<>]/.test(avatar);
      const isImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar);
      if (!isEmoji && !isImage) {
        return res.status(400).json({ error: 'Choose an emoji or PNG, JPEG, or WebP avatar.' });
      }
      updates.avatar = avatar;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No profile changes were provided.' });
    }

    const { data, error } = await req.db
      .from('synapse_profiles')
      .update(updates)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) return sendDatabaseError(res, error);
    return res.json({ profile: data });
  } catch (error) {
    return handleRouteError(res, error, 'Profile update failed');
  }
});

router.get('/decks', async (req, res) => {
  const { data, error } = await req.db
    .from('synapse_decks')
    .select('*, synapse_cards(*)')
    .order('created_at', { ascending: false });

  if (error) return sendDatabaseError(res, error);
  const decks = data.map(({ synapse_cards: cards, ...deck }) => ({
    ...deck,
    cards: cards || []
  }));
  return res.json({ decks });
});

router.get('/stats', async (req, res) => {
  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const [deckCount, cardCount, reviewCount, successfulReviews, recentReviews, dueCards, reviewDates] = await Promise.all([
    req.db.from('synapse_decks').select('id', { count: 'exact', head: true }),
    req.db.from('synapse_cards').select('id', { count: 'exact', head: true }),
    req.db.from('synapse_reviews').select('id', { count: 'exact', head: true }),
    req.db.from('synapse_reviews').select('id', { count: 'exact', head: true }).in('rating', ['good', 'easy']),
    req.db.from('synapse_reviews').select('reviewed_at, rating')
      .gte('reviewed_at', weekStart.toISOString())
      .limit(10000),
    req.db.from('synapse_cards').select('id', { count: 'exact', head: true }).lte('next_review_at', new Date().toISOString()),
    req.db.from('synapse_reviews').select('reviewed_at')
      .gte('reviewed_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
      .order('reviewed_at', { ascending: false })
      .limit(10000)
  ]);

  for (const result of [deckCount, cardCount, reviewCount, successfulReviews, recentReviews, dueCards, reviewDates]) {
    if (result.error) return sendDatabaseError(res, result.error);
  }

  const recent = recentReviews.data || [];
  const reviewsByDay = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    const count = recent.filter(review => review.reviewed_at.slice(0, 10) === key).length;
    return { date: key, count };
  });
  const reviewDaySet = new Set((reviewDates.data || []).map(review => review.reviewed_at.slice(0, 10)));
  const streakDate = new Date();
  streakDate.setUTCHours(0, 0, 0, 0);
  if (!reviewDaySet.has(streakDate.toISOString().slice(0, 10))) {
    streakDate.setUTCDate(streakDate.getUTCDate() - 1);
  }
  let streak = 0;
  while (reviewDaySet.has(streakDate.toISOString().slice(0, 10))) {
    streak++;
    streakDate.setUTCDate(streakDate.getUTCDate() - 1);
  }

  return res.json({
    deckCount: deckCount.count || 0,
    cardCount: cardCount.count || 0,
    reviewCount: reviewCount.count || 0,
    confidence: reviewCount.count ? Math.round(((successfulReviews.count || 0) / reviewCount.count) * 100) : 0,
    dueCount: dueCards.count || 0,
    streak,
    reviewsByDay
  });
});

router.post('/generate', async (req, res) => {
  try {
    const title = validateText(req.body.title, 'Deck title', 1, 100);
    const content = validateText(req.body.lectureContent, 'Study material', 30, 100000);
    const cardCount = Number(req.body.cardCount);
    if (![5, 10, 15, 20].includes(cardCount)) {
      return res.status(400).json({ error: 'Choose between 5, 10, 15, or 20 cards.' });
    }
    if (typeof req.body.enableSearch !== 'boolean') {
      return res.status(400).json({ error: 'Search preference must be true or false.' });
    }

    const deck = await saveGeneratedDeck(req, {
      title,
      sourceType: 'notes',
      sourceDetail: 'AI-generated from notes',
      content,
      enableSearch: req.body.enableSearch,
      cardCount
    });
    return res.status(201).json({ success: true, deck });
  } catch (error) {
    return handleRouteError(res, error, 'Flashcard generation failed');
  }
});

router.post('/upload-pdf', upload.single('pdfFile'), async (req, res) => {
  let parser;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Choose a PDF file to upload.' });
    }
    if (req.file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return res.status(400).json({ error: 'This file does not appear to be a valid PDF.' });
    }

    const title = validateText(req.body.title, 'Deck title', 1, 100);
    const cardCount = Number(req.body.cardCount);
    if (![5, 10, 15, 20].includes(cardCount)) {
      return res.status(400).json({ error: 'Choose between 5, 10, 15, or 20 cards.' });
    }
    if (!['true', 'false'].includes(req.body.enableSearch)) {
      return res.status(400).json({ error: 'Search preference must be true or false.' });
    }

    parser = new PDFParse({ data: req.file.buffer });
    const pdfData = await parser.getText();
    const content = (pdfData.text || '').trim();
    if (content.length < 30) {
      return res.status(422).json({ error: 'No readable text was found. This may be a scanned PDF; upload a text-based PDF or paste notes instead.' });
    }

    const safeFileName = path.basename(req.file.originalname).slice(0, 160);
    const deck = await saveGeneratedDeck(req, {
      title,
      sourceType: 'pdf',
      sourceDetail: `PDF · ${safeFileName}`,
      content,
      enableSearch: req.body.enableSearch === 'true',
      cardCount
    });
    return res.status(201).json({ success: true, deck });
  } catch (error) {
    return handleRouteError(res, error, 'PDF upload failed');
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
});

router.post('/review-card', async (req, res) => {
  const { cardId, rating } = req.body;
  if (typeof cardId !== 'string' || !/^[0-9a-f-]{36}$/i.test(cardId)) {
    return res.status(400).json({ error: 'A valid card ID is required.' });
  }
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) {
    return res.status(400).json({ error: 'Choose again, hard, good, or easy.' });
  }

  const { data: card, error: findError } = await req.db
    .from('synapse_cards')
    .select('id, repetition_level, interval_days, ease_factor')
    .eq('id', cardId)
    .maybeSingle();

  if (findError) return sendDatabaseError(res, findError);
  if (!card) return res.status(404).json({ error: 'Study card not found.' });

  const schedule = calculateReviewSchedule(card, rating);
  const { data, error } = await req.db.rpc('record_synapse_review', {
    p_card_id: cardId,
    p_rating: rating,
    p_repetition_level: schedule.repetition_level,
    p_interval_days: schedule.interval_days,
    p_ease_factor: schedule.ease_factor,
    p_next_review_at: schedule.next_review_at
  });

  if (error) return sendDatabaseError(res, error);
  return res.json({ success: true, card: data.card, profile: data.profile });
});

router.post('/award-xp', async (req, res) => {
  const amount = Number(req.body.amount);
  if (![20, 50].includes(amount)) {
    return res.status(400).json({ error: 'Invalid XP award.' });
  }
  const { data, error } = await req.db.rpc('award_synapse_xp', { p_amount: amount });
  if (error) return sendDatabaseError(res, error);
  return res.json({ profile: data });
});

router.delete('/decks/:deckId', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.deckId)) {
    return res.status(400).json({ error: 'A valid deck ID is required.' });
  }
  const { error } = await req.db.from('synapse_decks').delete().eq('id', req.params.deckId);
  if (error) return sendDatabaseError(res, error);
  return res.json({ success: true });
});

router.post('/explain', async (req, res) => {
  try {
    const question = validateText(req.body.question, 'Question', 1, 2000);
    const answer = validateText(req.body.answer, 'Answer', 1, 4000);
    const userQuery = req.body.userQuery ? validateText(req.body.userQuery, 'Follow-up', 1, 1000) : '';
    const client = getAiClient();
    const response = await client.chat.completions.create({
      model: getModel(),
      reasoning_effort: 'none',
      messages: [
        {
          role: 'system',
          content: 'You are a concise study tutor. Explain accurately in plain language, answer the learner’s question directly, and use **bold** for key terms. Do not expose hidden reasoning.'
        },
        {
          role: 'user',
          content: userQuery
            ? `Explain this study concept and answer the learner’s follow-up in 2-4 clear sentences. Use a brief analogy only if useful.\nConcept: ${question}\nAnswer: ${answer}\nLearner question: ${userQuery}`
            : `Explain this study concept in 2-4 clear sentences. Include a brief analogy only if useful.\nConcept: ${question}\nAnswer: ${answer}`
        }
      ],
      temperature: 0.2,
      max_tokens: 260
    }, { timeout: 20000 });
    const explanation = response.choices?.[0]?.message?.content;
    if (typeof explanation !== 'string' || !explanation.trim()) {
      return res.status(502).json({ error: 'The tutor returned an empty explanation. Please try again.' });
    }
    return res.json({ explanation: explanation.trim() });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    if (error?.name === 'APIConnectionTimeoutError' || error?.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'The explanation took too long. Please try again.' });
    }
    console.error('AI explanation failed:', error?.message || 'Unknown error');
    return res.status(502).json({ error: 'The tutor could not explain this concept right now. Please try again.' });
  }
});

router.post('/verify-tavily', async (req, res) => {
  try {
    const question = validateText(req.body.question, 'Question', 1, 2000);
    const answer = validateText(req.body.answer, 'Answer', 1, 4000);
    if (!process.env.TAVILY_API_KEY) {
      return res.status(503).json({ error: 'TAVILY_API_KEY is missing from .env.' });
    }

    const searchResponse = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: `${question} ${answer}`,
        search_depth: 'basic',
        max_results: 3
      })
    });

    if (!searchResponse.ok) {
      console.error('Tavily search failed with status:', searchResponse.status);
      return res.status(502).json({ error: 'Live research is temporarily unavailable.' });
    }
    const result = await searchResponse.json();
    const sources = (result.results || []).slice(0, 3).map(source => {
      let url;
      try {
        url = new URL(source.url);
      } catch {
        return null;
      }
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return {
        title: String(source.title || 'Research source').slice(0, 180),
        url: url.href,
        snippet: String(source.content || '').slice(0, 240)
      };
    }).filter(Boolean);

    return res.json({ success: true, sources });
  } catch (error) {
    return handleRouteError(res, error, 'Tavily research failed');
  }
});

router.post('/weakness-quiz', async (req, res) => {
  try {
    const weakCards = req.body.weakCards;
    if (!Array.isArray(weakCards) || weakCards.length === 0 || weakCards.length > 10) {
      return res.status(400).json({ error: 'Provide between 1 and 10 weak cards.' });
    }
    const concepts = weakCards.map(card => ({
      question: validateText(card?.question, 'Card question', 1, 2000),
      answer: validateText(card?.answer, 'Card answer', 1, 4000)
    }));

    const response = await getAiClient().chat.completions.create({
      model: getModel(),
      messages: [{
        role: 'user',
        content: `Create 3 multiple-choice questions that test understanding of these concepts. Return only a JSON array. Each item must have "question", "options" (exactly four distinct strings), "correctAnswer" (one exact option), and "explanation".\n${JSON.stringify(concepts)}`
      }],
      temperature: 0.25,
      max_tokens: 900
    });

    const questions = parseModelJson(response.choices[0]?.message?.content || '');
    if (!Array.isArray(questions) || questions.length !== 3) {
      throw new Error('The AI did not return three quiz questions.');
    }
    const quizQuestions = questions.map(item => {
      const question = validateText(item?.question, 'Quiz question', 1, 1000);
      const options = item.options;
      const correctAnswer = validateText(item?.correctAnswer, 'Correct answer', 1, 500);
      const explanation = validateText(item?.explanation, 'Explanation', 1, 2000);
      if (!Array.isArray(options) || options.length !== 4 || options.some(option => typeof option !== 'string' || !option.trim())) {
        throw new Error('The AI returned invalid quiz options.');
      }
      const cleanOptions = options.map(option => option.trim());
      if (new Set(cleanOptions.map(option => option.toLowerCase())).size !== 4 ||
          !cleanOptions.some(option => option.toLowerCase() === correctAnswer.toLowerCase())) {
        throw new Error('The AI returned inconsistent quiz answers.');
      }
      return { question, options: cleanOptions, correctAnswer, explanation };
    });
    return res.json({ success: true, quizQuestions });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.message });
    console.error('Weakness quiz generation failed:', error?.message || 'Unknown error');
    return res.status(502).json({ error: 'The AI could not create a valid quiz. Please try again.' });
  }
});

export function createApiRouter() {
  return router;
}
