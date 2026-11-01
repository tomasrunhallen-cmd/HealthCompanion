// Swedish names for the context bank's kinds, layers and origins.
import type { ContextKind, ContextLayer, ContextOrigin } from '../domain/types';

export const KIND_TEXT: Record<ContextKind, string> = {
  early: 'Tidigt tecken',
  serious: 'Allvarligt tecken',
  action_yellow: 'Åtgärd vid gult',
  action_red: 'Åtgärd vid rött',
  relatives: 'Anhöriga gör',
  akut: 'Akut formulering',
  trigger: 'Utlösare',
  false_alarm: 'Känt falsklarm',
  medication: 'Medicin',
  tone_yellow: 'Ton vid gult',
  tone_red: 'Ton vid rött',
  routine: 'Livsstil och rutin',
  contact: 'Kontakt',
  value_anchor: 'Värdeankare',
  wish: 'Önskemål',
  note_for_care: 'Till vården',
  normal_state: 'Normalläge',
  typical_phrase: 'Typisk formulering',
  period_low: 'Tidigare nedstämd period',
  period_high: 'Tidigare uppvarvad period',
  period_mixed: 'Tidigare blandad period',
  course: 'Känt förlopp',
  medication_taken: 'Medicin tagen',
  routine_done: 'Rutin i dag',
  red_step: 'Steg efter röd dag',
  event: 'Kommande händelse',
  correction: 'Rättelse',
};

export const LAYER_TEXT: Record<ContextLayer, { title: string; help: string }> = {
  grund: { title: 'Grund', help: 'Din krisplan och det du själv vet om dig. Ändras bara av dig.' },
  profil: { title: 'Profil', help: 'Hur du brukar vara och hur tidigare perioder sett ut. Ändras bara genom förslag du godkänt.' },
  dagligt: { title: 'Dagligt', help: 'Medicin, kommande händelser och dina rättelser.' },
};

export const ORIGIN_TEXT: Record<ContextOrigin, string> = {
  standard: 'Standard',
  crisis_plan: 'Från krisplanen',
  user: 'Du själv',
  suggested: 'Godkänt förslag',
  correction: 'Din rättelse',
};
