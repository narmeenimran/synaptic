function validateText(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`The AI returned an invalid ${label}.`);
  }
  return value.trim();
}

export function validateDeckQuiz(generated, sourceCards) {
  if (!Array.isArray(generated) || generated.length !== sourceCards.length) {
    throw new Error('The AI returned an incomplete quiz.');
  }

  const cardById = new Map(sourceCards.map(card => [card.id || card.sourceCardId, card]));
  return generated.map(item => {
    const sourceCard = cardById.get(item?.sourceCardId);
    const question = validateText(item?.question, 'quiz question', 1000);
    const generatedAnswer = validateText(item?.correctAnswer, 'correct answer', 500);
    const hint = validateText(item?.hint, 'quiz hint', 500);
    const explanation = validateText(item?.explanation, 'quiz explanation', 1000);
    if (!sourceCard || !Array.isArray(item.options) || item.options.length !== 4 ||
        item.options.some(option => typeof option !== 'string' || !option.trim())) {
      throw new Error('The AI returned invalid quiz options or source references.');
    }
    const options = item.options.map(option => option.trim());
    const answerMatch = generatedAnswer.match(/^(?:option\s*)?([A-D])(?:[.)\s]|$)/i);
    const correctAnswer = options.find(option => option.toLowerCase() === generatedAnswer.toLowerCase()) ||
      (answerMatch ? options[answerMatch[1].toUpperCase().charCodeAt(0) - 65] : null);
    if (new Set(options.map(option => option.toLowerCase())).size !== 4 || !correctAnswer) {
      throw new Error('The AI returned inconsistent quiz answers.');
    }
    return {
      question,
      options,
      correctAnswer,
      hint,
      explanation,
      sourceCard: sourceCard.question
    };
  });
}
