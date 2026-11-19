import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildRuleDraft, OPEN_ASSESSMENT } from '../shared/caseDraft';

test('the rule-based draft weaves the dossier into the sections and leaves judgements open', () => {
  const template = {
    name: 'KESB', domain: 'kesb' as const,
    sections: [
      { key: 'mandate', title: '1', description: '', promptGuidance: '', isRequired: true, order: 1 },
      { key: 'interviews_summary', title: '3', description: '', promptGuidance: '', isRequired: true, order: 2 },
      { key: 'recommendation', title: '8', description: '', promptGuidance: '', isRequired: true, order: 3 },
    ],
  };
  const draft = buildRuleDraft(
    { reference_number: 'K-1', title: 'Fall', subject_name: 'Max Muster', subject_dob: '1980-01-02', lead_user_name: 'Anna' },
    template,
    [],
    [{ interviewee_name: 'Eva', interviewee_role: 'witness', interview_date: '2026-01-01', duration_minutes: 30, summary: 'kurz', summary_stale: false, transcript_text: 'lang', transcript_stale: false }],
  );
  assert.equal(draft.title, 'KESB — Max Muster (K-1)');
  assert.match(draft.sections_content.mandate, /Max Muster \(geb\. 1980-01-02\)/);
  assert.match(draft.sections_content.interviews_summary, /Befragung von Eva/);
  assert.match(draft.sections_content.recommendation, new RegExp(OPEN_ASSESSMENT.replace(/[[\]]/g, '\\$&')));
});
