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

test('generation requests the selected count in one call with a bounded prompt and token budget', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  const cards = Array.from({ length: 20 }, (_, index) => ({
    question: `Question ${index + 1}`,
    answer: `Answer ${index + 1}`
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

  const generated = await generateFlashcards('x'.repeat(100000), false, 20);

  assert.equal(generated.length, 20);
  assert.equal(requestBody.model, 'nvidia/Nemotron-3_5-Lightning');
  assert.equal(requestBody.max_tokens, 3000);
  assert.ok(requestBody.messages[1].content.length < 21000);
  assert.match(requestBody.messages[1].content, /Create exactly 20 distinct flashcards/);
});

test('generation validates material, card-count, and search boundaries before calling AI', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response('{}', { status: 200 });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  const validMaterial = 'x'.repeat(30);
  const invalidInputs = [
    [ 'x'.repeat(29), false, 5, /between 30 and 100,000/ ],
    [ 'x'.repeat(100001), false, 5, /between 30 and 100,000/ ],
    [ validMaterial, false, 0, /Choose between 1 and 20/ ],
    [ validMaterial, false, 21, /Choose between 1 and 20/ ],
    [ validMaterial, 'true', 5, /Search preference must be true or false/ ]
  ];

  for (const [material, enableSearch, count, message] of invalidInputs) {
    await assert.rejects(generateFlashcards(material, enableSearch, count), message);
  }
  assert.equal(fetchCalls, 0);
});

test('generation accepts 30 and 100,000 character inputs and card counts from 1 through 20', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  let nextQuestion = 1;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const match = body.messages[1].content.match(/Create exactly (\d+) (?:distinct|new)/);
    const count = Number(match[1]);
    const cards = Array.from({ length: count }, (_, index) => ({
      question: `Question ${nextQuestion + index}`,
      answer: `Answer ${nextQuestion + index}`
    }));
    nextQuestion += count;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  for (const material of ['x'.repeat(30), 'x'.repeat(100000)]) {
    for (const count of [1, 5, 10, 15, 20]) {
      const cards = await generateFlashcards(material, false, count);
      assert.equal(cards.length, count, `${material.length} chars, ${count} cards`);
    }
  }
});

test('generation rejects incomplete output without making additional slow AI calls', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = async (_url, options) => {
    fetchCalls++;
    const cards = Array.from({ length: 2 }, (_, index) => ({
      question: `Unique concept ${index + 1}`,
      answer: `Answer ${index + 1}`
    }));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  await assert.rejects(
    generateFlashcards(
      'ATP stores energy for cellular processes, and it can transfer a phosphate group to other molecules.',
      false,
      20
    ),
    /The AI returned 2 of 20 requested flashcards/
  );

  assert.equal(fetchCalls, 1);
});

test('generation safely rejects raw text responses as a clean incomplete response', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'The generated cards are unavailable right now.' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

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
    /The AI returned 0 of 5 requested flashcards/
  );
  assert.equal(fetchCalls, 1);
});
