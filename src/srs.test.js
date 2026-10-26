import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReviewSchedule } from './srs.js';

const reviewedAt = new Date('2026-10-26T12:00:00.000Z');

test('again resets mastery and schedules a short retry', () => {
  const schedule = calculateReviewSchedule({
    repetition_level: 4,
    interval_days: 20,
    ease_factor: 2.5
  }, 'again', reviewedAt);

  assert.equal(schedule.repetition_level, 0);
  assert.equal(schedule.interval_days, 0);
  assert.equal(schedule.ease_factor, 2.3);
  assert.equal(schedule.next_review_at, '2026-10-26T12:10:00.000Z');
});

test('good ratings increase intervals progressively', () => {
  const first = calculateReviewSchedule({ repetition_level: 0, interval_days: 0, ease_factor: 2.5 }, 'good', reviewedAt);
  const second = calculateReviewSchedule({ repetition_level: 1, interval_days: 1, ease_factor: 2.5 }, 'good', reviewedAt);
  const later = calculateReviewSchedule({ repetition_level: 2, interval_days: 3, ease_factor: 2.5 }, 'good', reviewedAt);

  assert.deepEqual([first.interval_days, second.interval_days, later.interval_days], [3, 6, 8]);
});

test('hard ratings slow the schedule and lower ease without underflow', () => {
  const schedule = calculateReviewSchedule({
    repetition_level: 2,
    interval_days: 5,
    ease_factor: 1.35
  }, 'hard', reviewedAt);

  assert.equal(schedule.interval_days, 6);
  assert.equal(schedule.ease_factor, 1.3);
  assert.equal(schedule.repetition_level, 3);
});

test('easy ratings create a longer interval and raise ease', () => {
  const schedule = calculateReviewSchedule({
    repetition_level: 0,
    interval_days: 0,
    ease_factor: 2.5
  }, 'easy', reviewedAt);

  assert.equal(schedule.interval_days, 4);
  assert.equal(schedule.ease_factor, 2.65);
});

test('unknown ratings are rejected', () => {
  assert.throws(
    () => calculateReviewSchedule({ repetition_level: 0 }, 'unknown', reviewedAt),
    /Rating must be again, hard, good, or easy/
  );
});
