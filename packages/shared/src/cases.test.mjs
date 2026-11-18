import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CASE_DOMAINS,
  CASE_STATUSES,
  CASE_CONFIDENTIALITIES,
  CASE_DOCUMENT_CATEGORIES,
  CASE_INTERVIEWEE_ROLES,
  ASSESSMENT_STATUSES,
  isValidCaseDomain,
  isValidCaseStatus,
  isValidCaseConfidentiality,
  isValidDocumentCategory,
  isValidIntervieweeRole,
  isValidAssessmentStatus,
} from './cases.ts';

test('validates case domains correctly', () => {
  for (const d of CASE_DOMAINS) assert.equal(isValidCaseDomain(d), true);
  assert.equal(isValidCaseDomain('invalid_domain'), false);
  assert.equal(isValidCaseDomain(''), false);
});

test('validates case statuses correctly', () => {
  for (const s of CASE_STATUSES) assert.equal(isValidCaseStatus(s), true);
  assert.equal(isValidCaseStatus('unknown'), false);
});

test('validates confidentiality levels', () => {
  for (const c of CASE_CONFIDENTIALITIES) assert.equal(isValidCaseConfidentiality(c), true);
  assert.equal(isValidCaseConfidentiality('secret'), false);
});

test('validates document categories and interview roles', () => {
  for (const cat of CASE_DOCUMENT_CATEGORIES) assert.equal(isValidDocumentCategory(cat), true);
  assert.equal(isValidDocumentCategory('foo'), false);

  for (const r of CASE_INTERVIEWEE_ROLES) assert.equal(isValidIntervieweeRole(r), true);
  assert.equal(isValidIntervieweeRole('alien'), false);
});

test('validates assessment statuses', () => {
  for (const s of ASSESSMENT_STATUSES) assert.equal(isValidAssessmentStatus(s), true);
  assert.equal(isValidAssessmentStatus('pending'), false);
});
