const DEFAULT_MODEL = 'nvidia/Nemotron-3_5-Lightning';
const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

function extractCards(content) {
  const cleaned = content.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned);
  const cards = Array.isArray(parsed) ? parsed : parsed?.cards;
  if (!Array.isArray(cards)) throw new Error('The AI response did not contain a flashcard list.');
  return cards;
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
  if (![5, 10, 15, 20].includes(Number(cardCount))) {
    throw new Error('Choose between 5, 10, 15, or 20 flashcards.');
  }
  if (typeof enableSearch !== 'boolean') {
    throw new Error('Search preference must be true or false.');
  }
  if (!process.env.NEBIUS_API_KEY) {
    throw Object.assign(new Error('NEBIUS_API_KEY is missing from .env.'), { status: 503 });
  }

  const searchContext = enableSearch ? await searchContextFor(lectureContent) : '';
  const count = Number(cardCount);
  const cards = [];
  const questions = new Set();

  while (cards.length < count) {
    const batchCount = Math.min(5, count - cards.length);
    const batchEnd = cards.length + batchCount;
    let consecutiveEmptyResponses = 0;
    let batchAttempts = 0;

    while (cards.length < batchEnd && batchAttempts < 8 && consecutiveEmptyResponses < 5) {
      const remaining = batchEnd - cards.length;
      const requestedCandidates = Math.max(5, remaining);
      batchAttempts++;
      const candidates = await requestFlashcardBatch(
        lectureContent,
        requestedCandidates,
        searchContext,
        cards
      );
      const freshCards = [];
      for (const card of candidates) {
        if (freshCards.length >= remaining) break;
        const key = card.question.toLocaleLowerCase();
        if (questions.has(key)) continue;
        questions.add(key);
        freshCards.push(card);
      }

      if (!freshCards.length) {
        consecutiveEmptyResponses++;
        console.warn(`AI returned no new valid flashcards; retrying the remaining ${remaining} card(s).`);
        continue;
      }

      consecutiveEmptyResponses = 0;
      cards.push(...freshCards);
    }

    if (cards.length < batchEnd && batchAttempts >= 8) {
      throw Object.assign(
        new Error(`The AI could not complete the requested ${count} flashcards after several attempts. Please try again or use shorter study material.`),
        { status: 502 }
      );
    }
    if (cards.length < batchEnd && consecutiveEmptyResponses >= 5) {
      throw Object.assign(
        new Error(`The AI repeatedly returned incomplete flashcards. ${cards.length} of ${count} were generated; please try again or use shorter study material.`),
        { status: 502 }
      );
    }
  }

  return cards;
}

async function requestFlashcardBatch(lectureContent, cardCount, searchContext, previousCards) {
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
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Create accurate active-recall flashcards grounded only in the provided study material. Return valid JSON only, as an object with a "cards" array. Each card must contain only string "question" and "answer" fields. Every card must test a different fact or relationship, and must not repeat the facts or questions in the prior cards provided by the user. Choose uncovered facts from other parts of the source; if necessary, test a distinct implication or contrast that is directly supported by the material. Keep cards concise and escape JSON strings correctly.'
          },
          {
            role: 'user',
            content: `Create exactly ${cardCount} new flashcards in this batch. The following complete cards already exist; do not repeat their questions or test the same facts: ${JSON.stringify(previousCards)}. Favor concise questions and answers. Do not invent claims unsupported by the material.\n${searchContext ? `Use this additional web context only when relevant:\n${searchContext}\n` : ''}Study material:\n${lectureContent.trim()}`
          }
        ],
        temperature: 0.5,
        max_tokens: Math.min(5000, cardCount * 300)
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

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  try {
    if (typeof content !== 'string') throw new Error('The AI returned an empty response.');
    return validateCards(extractCards(content)).slice(0, cardCount);
  } catch (error) {
    console.warn(`AI flashcard batch did not validate (${cardCount} requested):`, error.message);
    return [];
  }
}
