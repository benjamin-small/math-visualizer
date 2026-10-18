// The guided tour's cards: a step on the strip, the tour's quality slider and the
// lab's "How JPEG works" button. Each is worked out from the target alone.
import { STAGES } from '../stages';
import { TOUR_STEPS } from '../tour';
import type { ExplainContext } from './context';
import type { Target } from './targets';
import type { Explanation } from './types';

function stepCard(t: Extract<Target, { id: 'tour.step' }>): Explanation | null {
  const step = TOUR_STEPS.find((s) => s.id === t.step);
  if (!step) return null;
  const stage = STAGES.find((s) => s.id === step.stage)?.title ?? step.stage;
  return {
    title: step.heading,
    value: `Step ${step.n} of ${TOUR_STEPS.length}`,
    body: step.card,
    consequence: `${step.lossy ? "Loses detail you can't get back." : 'Nothing is lost here.'} In the lab: step ${step.n}, ${stage}.`,
    acts: true,
    details: [],
  };
}

function qualityCard(t: Extract<Target, { id: 'tour.quality' }>): Explanation {
  return {
    title: 'Quality',
    value: `${t.quality}`,
    body: 'How hard the fine detail is rounded off.',
    consequence: `Lower means a smaller file and softer edges.${t.quality >= 90 ? ' Higher keeps more detail.' : ''}`,
    acts: true,
    details: [],
  };
}

function openCard(): Explanation {
  return {
    title: 'How JPEG works',
    value: '9 steps',
    body: 'A short walk through how a picture becomes a JPEG, using your picture.',
    consequence: 'Takes about a minute.',
    acts: true,
    details: [],
  };
}

/** The card for a tour target; null for an id this module does not own. */
export function explainTour(t: Target, _ctx: ExplainContext): Explanation | null {
  switch (t.id) {
    case 'tour.step':
      return stepCard(t);
    case 'tour.quality':
      return qualityCard(t);
    case 'tour.open':
      return openCard();
    default:
      return null;
  }
}
