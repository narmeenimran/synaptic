import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_DECKS } from './starter-decks.js';

test('starter decks contain three complete decks with the requested card counts', () => {
  assert.equal(STARTER_DECKS.length, 3);
  assert.deepEqual(STARTER_DECKS.map(deck => deck.cards.length), [5, 10, 15]);
  assert.match(STARTER_DECKS[0].title, /Biology/i);
  assert.match(STARTER_DECKS[1].title, /AI/i);
  for (const deck of STARTER_DECKS) {
    assert.ok(deck.title);
    for (const card of deck.cards) {
      assert.ok(card.question);
      assert.ok(card.answer);
    }
  }
});
