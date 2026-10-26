import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFlashcards } from './flashcards.js';

test('generation requests structured JSON and accepts escaped card text', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  const cards = Array.from({ length: 5 }, (_, index) => ({
    question: `Question ${index + 1}: what does "ATP" mean?`,
    answer: 'A molecule used to transfer energy.'
  }));
  let requestBody;

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  const generated = await generateFlashcards(
    'ATP stores energy for cellular processes, and it can transfer a phosphate group to other molecules.',
    false,
    5
  );

  assert.equal(requestBody.response_format.type, 'json_object');
  assert.equal(generated.length, 5);
  assert.equal(generated[0].question, cards[0].question);
});

test('generation rejects malformed structured JSON with a useful message', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"cards":[{"question":"broken"' } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  await assert.rejects(
    generateFlashcards(
      'ATP stores energy for cellular processes, and it can transfer a phosphate group to other molecules.',
      false,
      5
    ),
    /Could not validate AI flashcards:/
  );
});
