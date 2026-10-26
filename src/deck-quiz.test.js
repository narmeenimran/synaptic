import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeckQuiz } from './deck-quiz.js';

const sourceCards = [
  { id: 'card-1', question: 'What does ATP store?', answer: 'Energy for cellular work.' }
];

const generatedQuiz = [{
  sourceCardId: 'card-1',
  question: 'What is ATP primarily used for?',
  options: ['Cellular energy', 'Storing genetic code', 'Building cell walls', 'Transporting oxygen'],
  correctAnswer: 'Cellular energy',
  hint: 'Think about what cells need to power their processes.',
  explanation: 'ATP transfers usable energy to cellular processes.'
}];

test('validates MCQ choices, hints, and source-card grounding', () => {
  const [question] = validateDeckQuiz(generatedQuiz, sourceCards);

  assert.equal(question.correctAnswer, 'Cellular energy');
  assert.match(question.hint, /power their processes/);
  assert.equal(question.sourceCard, sourceCards[0].question);
});

test('normalizes a letter-based correct answer to its full option text', () => {
  const [question] = validateDeckQuiz(
    [{ ...generatedQuiz[0], correctAnswer: 'C' }],
    sourceCards
  );

  assert.equal(question.correctAnswer, 'Building cell walls');
});

test('validates questions against the sourceCardId shape used by the API', () => {
  const apiSourceCards = [{
    sourceCardId: 'card-1',
    question: sourceCards[0].question,
    answer: sourceCards[0].answer
  }];
  const [question] = validateDeckQuiz(generatedQuiz, apiSourceCards);

  assert.equal(question.sourceCard, sourceCards[0].question);
});

test('rejects quiz questions linked to cards outside the selected deck', () => {
  assert.throws(
    () => validateDeckQuiz([{ ...generatedQuiz[0], sourceCardId: 'another-user-card' }], sourceCards),
    /source references/
  );
});

test('rejects duplicate options and missing hints', () => {
  assert.throws(
    () => validateDeckQuiz([{ ...generatedQuiz[0], options: ['A', 'A', 'B', 'C'] }], sourceCards),
    /inconsistent quiz answers/
  );
  assert.throws(
    () => validateDeckQuiz([{ ...generatedQuiz[0], hint: '' }], sourceCards),
    /invalid quiz hint/
  );
  assert.throws(
    () => validateDeckQuiz([{ ...generatedQuiz[0], correctAnswer: 'E' }], sourceCards),
    /inconsistent quiz answers/
  );
});
