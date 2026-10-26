const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TEN_MINUTES_IN_MS = 10 * 60 * 1000;

export function calculateReviewSchedule(card, rating, reviewedAt = new Date()) {
  const repetitionLevel = Math.max(0, Number(card.repetition_level) || 0);
  const intervalDays = Math.max(0, Number(card.interval_days) || 0);
  const easeFactor = Math.max(1.3, Number(card.ease_factor) || 2.5);
  let nextLevel = repetitionLevel;
  let nextInterval = intervalDays;
  let nextEase = easeFactor;
  let nextDate;

  if (rating === 'again') {
    nextLevel = 0;
    nextInterval = 0;
    nextEase = Math.max(1.3, easeFactor - 0.2);
    nextDate = reviewedAt.getTime() + TEN_MINUTES_IN_MS;
  } else if (rating === 'hard') {
    nextLevel = repetitionLevel + 1;
    nextInterval = Math.max(1, Math.round((intervalDays || 1) * 1.2));
    nextEase = Math.max(1.3, easeFactor - 0.15);
    nextDate = reviewedAt.getTime() + nextInterval * DAY_IN_MS;
  } else if (rating === 'good') {
    nextLevel = repetitionLevel + 1;
    nextInterval = repetitionLevel === 0
      ? 3
      : repetitionLevel === 1
        ? 6
        : Math.max(1, Math.round((intervalDays || 1) * easeFactor));
    nextDate = reviewedAt.getTime() + nextInterval * DAY_IN_MS;
  } else if (rating === 'easy') {
    nextLevel = repetitionLevel + 1;
    nextInterval = repetitionLevel === 0
      ? 4
      : Math.max(4, Math.round((intervalDays || 1) * easeFactor * 1.3));
    nextEase = easeFactor + 0.15;
    nextDate = reviewedAt.getTime() + nextInterval * DAY_IN_MS;
  } else {
    throw new Error('Rating must be again, hard, good, or easy.');
  }

  return {
    repetition_level: nextLevel,
    interval_days: nextInterval,
    ease_factor: Number(nextEase.toFixed(2)),
    next_review_at: new Date(nextDate).toISOString()
  };
}
