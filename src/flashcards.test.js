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

test('generation fills a partial batch by requesting only the missing cards', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  const cards = Array.from({ length: 5 }, (_, index) => ({
    question: `Question ${index + 1}`,
    answer: `Answer ${index + 1}`
  }));
  const requestBodies = [];

  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    const responseCards = requestBodies.length === 1 ? cards.slice(0, 4) : cards.slice(4);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards: responseCards }) } }]
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

  assert.equal(generated.length, 5);
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[1].messages[1].content, /Create exactly 5 new flashcards/);
  assert.match(requestBodies[1].messages[1].content, /Question 1/);
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
    [ validMaterial, false, 4, /Choose between 5, 10, 15, or 20/ ],
    [ validMaterial, false, 21, /Choose between 5, 10, 15, or 20/ ],
    [ validMaterial, 'true', 5, /Search preference must be true or false/ ]
  ];

  for (const [material, enableSearch, count, message] of invalidInputs) {
    await assert.rejects(generateFlashcards(material, enableSearch, count), message);
  }
  assert.equal(fetchCalls, 0);
});

test('generation accepts 30 and 100,000 character inputs and all supported card counts', async t => {
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
    for (const count of [5, 10, 15, 20]) {
      const cards = await generateFlashcards(material, false, count);
      assert.equal(cards.length, count, `${material.length} chars, ${count} cards`);
    }
  }
});

test('generation continues until a 20-card deck is full when the AI under-delivers each batch', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  const requestedCounts = [];
  let nextConcept = 1;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const requested = Number(body.messages[1].content.match(/Create exactly (\d+) (?:distinct|new)/)[1]);
    requestedCounts.push(requested);
    const generated = Math.min(2, requested);
    const cards = Array.from({ length: generated }, (_, index) => ({
      question: `Unique concept ${nextConcept + index}`,
      answer: `Answer ${nextConcept + index}`
    }));
    nextConcept += generated;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ cards }) } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = originalApiKey;
  });

  const cards = await generateFlashcards(
    'ATP stores energy for cellular processes, and it can transfer a phosphate group to other molecules.',
    false,
    20
  );

  assert.equal(cards.length, 20);
  assert.equal(new Set(cards.map(card => card.question)).size, 20);
  assert.ok(requestedCounts.length > 4);
  assert.equal(requestedCounts[0], 5);
  assert.ok(requestedCounts.every(count => count >= 1 && count <= 5));
});

test('generation reports a clear error after repeated invalid AI batches', async t => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = 'test-key';
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"cards":[{"question":"broken"' } }]
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
    /AI repeatedly returned incomplete flashcards\. 0 of 5 were generated/
  );
  assert.equal(fetchCalls, 5);
});
