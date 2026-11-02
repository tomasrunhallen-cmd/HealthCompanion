// Shared by the phase C tests: an invented plan written as text blocks, and check-in helpers.

import { emptyPlan, type PlanBlock } from '../../src/core/plan/blocks';
import { savePlanBlocks } from '../../src/services/planBlocks';
import { memoryBackend } from '../../src/storage/backend';
import { Repository } from '../../src/storage/repository';

/** An invented plan with signs in both directions, routines, steps, a ladder and a contact. */
export async function repoWithPlan(): Promise<Repository> {
  const repo = await Repository.create(memoryBackend());
  const text: Partial<Record<PlanBlock['type'], string>> = {
    routine: 'Sömn 22:30–07:00\nPromenad varje dag',
    early_up: 'Pratar fortare\nHandlar saker jag inte behöver',
    early_down: 'Svarar inte på sms',
    serious_down: 'Slutar äta',
    action_serious: '1. Ringer mottagningen\n2. Ber min bror komma hem',
    relatives_early: 'Frågar hur jag sovit',
    others_serious: 'Mottagningen erbjuder en tid samma dag',
    ladder: '1. Om jag inte lyssnar på mina närstående ringer de mottagningen.',
    contacts: 'Mottagningen 08-123 456 78',
  };
  await savePlanBlocks(repo, emptyPlan().map((b) => ({ ...b, text: text[b.type] ?? '' })));
  return repo;
}


export const at = (day: string, time = '21:00') => new Date(`${day}T${time}:00`);
export const note = (transcript: string) => ({ transcript, mood: 0, energy: 5, wordsPerMinute: null });
