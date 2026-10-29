const DEFAULT_MODEL = 'nvidia/Nemotron-3_5-Lightning';
const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

function extractCards(content) {
  if (typeof content !== 'string') return [];
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
    return Array.isArray(cards) ? cards : [];
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) return [];
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
      return Array.isArray(cards) ? cards : [];
    } catch {
      return [];
    }
  }
}

function validateCards(cards) {
  if (!Array.isArray(cards)) throw new Error('The AI response did not contain a flashcard list.');
  return cards.flatMap(card => {
    if (typeof card?.question !== 'string' || typeof card?.answer !== 'string') return [];
    const question = card.question.trim();
    const answer = card.answer.trim();
    if (!question || !answer || question.length > 2000 || answer.length > 4000) return [];
    return [{ question, answer }];
  });
}

function splitStudyMaterial(content) {
  const sentences = content
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);
  const passages = [];

  for (const sentence of sentences.length ? sentences : [content.trim()]) {
    let remaining = sentence;
    while (remaining.length > 500) {
      let splitAt = remaining.lastIndexOf(' ', 500);
      if (splitAt < 1) splitAt = 500;
      passages.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
    if (remaining) passages.push(remaining);
  }

  return passages;
}

function createFallbackCards(content, count, existingCards) {
  const passages = splitStudyMaterial(content);
  const questionPrompts = [
    'What does the study material state?',
    'Which point is described in the study material?',
    'What detail should you recall from the study material?'
  ];
  const existingQuestions = new Set(existingCards.map(card => card.question.toLocaleLowerCase()));
  const fallbackCards = [];
  let passageIndex = 0;

  while (fallbackCards.length < count) {
    const passage = passages[passageIndex % passages.length];
    const cardNumber = existingCards.length + fallbackCards.length + 1;
    const prompt = questionPrompts[passageIndex % questionPrompts.length];
    const question = `${prompt} (point ${cardNumber})`;
    if (!existingQuestions.has(question.toLocaleLowerCase())) {
      existingQuestions.add(question.toLocaleLowerCase());
      fallbackCards.push({ question, answer: passage });
    }
    passageIndex++;
  }

  return fallbackCards;
}

async function getProviderErrorDetail(response) {
  const body = await response.text();
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message || parsed.message || body;
  } catch {
    // Keep non-JSON provider responses available for server-side diagnostics.
  }
  return String(detail)
    .replaceAll(process.env.NEBIUS_API_KEY || '', '[REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function providerErrorMessage(status) {
  if (status === 400) return 'Nebius rejected this generation request. Try shorter study material or generate fewer cards.';
  if (status === 401) return 'Nebius rejected its API key. Check NEBIUS_API_KEY in .env and restart the server.';
  if (status === 403) return 'The Nebius API key does not have access to this model. Check the key permissions and NEBIUS_MODEL setting.';
  if (status === 404) return 'Nebius could not find the configured model or API endpoint. Check NEBIUS_MODEL and NEBIUS_BASE_URL.';
  if (status === 429) return 'Nebius is rate-limiting requests or the account has reached its usage limit. Wait a moment and try again.';
  if (status >= 500) return 'Nebius card generation is temporarily unavailable. Please try again shortly.';
  return `Nebius rejected the generation request (HTTP ${status}). Check the server log for details.`;
}

async function searchContextFor(content) {
  if (!process.env.TAVILY_API_KEY) {
    throw Object.assign(new Error('TAVILY_API_KEY is missing from .env; turn off web research or configure Tavily.'), { status: 503 });
  }

  let response;
  try {
    response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: content.slice(0, 500),
        search_depth: 'basic',
        max_results: 3
      })
    });
  } catch {
    throw Object.assign(new Error('Tavily research could not connect. Check the API key and network connection.'), { status: 502 });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`Tavily research returned status ${response.status}.`), { status: 502 });
  }
  const result = await response.json();
  return (result.results || [])
    .slice(0, 3)
    .map(item => `${item.title}: ${item.content}`)
    .join('\n')
    .slice(0, 3000);
}

export async function generateFlashcards(lectureContent, enableSearch = false, cardCount = 10) {
  if (typeof lectureContent !== 'string' || lectureContent.trim().length < 30 || lectureContent.length > 100000) {
    throw new Error('Study material must contain between 30 and 100,000 characters.');
  }
  const count = Number(cardCount);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('Choose between 1 and 20 flashcards.');
  }
  if (typeof enableSearch !== 'boolean') {
    throw new Error('Search preference must be true or false.');
  }
  const source = lectureContent.slice(0, 20000);
  const questions = new Set();
  const uniqueCards = [];
  let searchContext = '';

  if (enableSearch) {
    try {
      searchContext = await searchContextFor(source);
    } catch (error) {
      console.warn('Web research unavailable; continuing generation without it:', error?.message || 'Unknown error');
    }
  }

  if (process.env.NEBIUS_API_KEY) {
    for (let attempt = 0; attempt < 2 && uniqueCards.length < count; attempt++) {
      const neededCount = count - uniqueCards.length;
      try {
        const candidates = await requestFlashcards(source, neededCount, searchContext, uniqueCards);
        for (const card of validateCards(candidates)) {
          if (uniqueCards.length >= count) break;
          const key = card.question.toLocaleLowerCase();
          if (questions.has(key)) continue;
          questions.add(key);
          uniqueCards.push(card);
        }
      } catch (error) {
        console.warn(`AI card generation attempt ${attempt + 1} failed:`, error?.message || 'Unknown error');
      }
    }
  } else {
    console.warn('NEBIUS_API_KEY is missing; using study-material fallback cards.');
  }

  const remainingCount = count - uniqueCards.length;
  if (remainingCount > 0) {
    console.warn(`Using ${remainingCount} study-material fallback card(s) to complete the requested deck.`);
    uniqueCards.push(...createFallbackCards(source, remainingCount, uniqueCards));
  }

  return uniqueCards;
}

async function requestFlashcards(lectureContent, cardCount, searchContext, existingCards) {
  const model = process.env.NEBIUS_MODEL || DEFAULT_MODEL;
  const baseUrl = (process.env.NEBIUS_BASE_URL || NEBIUS_BASE_URL).replace(/\/+$/, '');
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.NEBIUS_API_KEY}`
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Create accurate active-recall flashcards grounded only in the provided study material. Return valid JSON only, as an object with a "cards" array. Each card must contain only string "question" and "answer" fields. Every card must test a different fact or relationship. Keep cards concise and escape JSON strings correctly.'
          },
          {
            role: 'user',
            content: `Create exactly ${cardCount} distinct flashcards. Do not repeat these existing questions: ${JSON.stringify(existingCards.map(card => card.question))}. Favor concise questions and answers. Do not invent claims unsupported by the material.\n${searchContext ? `Use this additional web context only when relevant:\n${searchContext}\n` : ''}Study material:\n${lectureContent.trim()}`
          }
        ],
        temperature: 0.5,
        max_tokens: cardCount * 250
      })
    });
  } catch {
    throw Object.assign(new Error('AI card generation could not connect. Check the Nebius API key and network connection.'), { status: 502 });
  }

  if (!response.ok) {
    const detail = await getProviderErrorDetail(response);
    console.error(`Nebius card generation failed with status ${response.status}:`, detail || '(no error detail)');
    throw Object.assign(new Error(providerErrorMessage(response.status)), { status: 502 });
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error('The AI returned an invalid response. Please try again.'), { status: 502 });
  }
  const content = result.choices?.[0]?.message?.content;
  return extractCards(content);
}
