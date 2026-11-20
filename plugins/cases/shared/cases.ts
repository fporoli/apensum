// Cases & Assessments module: Domain models, templates, and validation logic.
//
// Keep this file erasable TypeScript (no enums; type-only imports are fine) so Node tests can load it directly.

import type { Envelope } from './caseCrypto';

export const CASE_DOMAINS = ['kesb', 'forensic_psychiatry', 'police', 'social', 'custom'] as const;
export type CaseDomain = (typeof CASE_DOMAINS)[number];

export const CASE_STATUSES = ['open', 'in_progress', 'review', 'completed', 'archived'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_CONFIDENTIALITIES = ['standard', 'confidential', 'strictly_confidential'] as const;
export type CaseConfidentiality = (typeof CASE_CONFIDENTIALITIES)[number];

export const CASE_DOCUMENT_CATEGORIES = [
  'court_decree',
  'medical',
  'police_report',
  'evidence',
  'correspondence',
  'financial',
  'other',
] as const;
export type CaseDocumentCategory = (typeof CASE_DOCUMENT_CATEGORIES)[number];

export const CASE_INTERVIEWEE_ROLES = [
  'subject',
  'witness',
  'relative',
  'expert',
  'officer',
  'informant',
  'other',
] as const;
export type CaseIntervieweeRole = (typeof CASE_INTERVIEWEE_ROLES)[number];

export const ASSESSMENT_STATUSES = ['draft', 'in_review', 'final', 'signed'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export interface AssessmentTemplateSection {
  key: string;
  title: string;
  description?: string;
  promptGuidance?: string;
  isRequired: boolean;
  order: number;
}

export interface AssessmentTemplate {
  id: string;
  organization_id: string | null;
  name: string;
  domain: CaseDomain;
  description: string | null;
  sections: AssessmentTemplateSection[];
  letterhead_config: Record<string, unknown>;
  is_default: boolean;
  /** An AI draft may be made with this template (sends names, document texts and transcripts to the AI provider). */
  ai_allowed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  organization_id: string;
  reference_number: string;
  title: string;
  domain: CaseDomain;
  subject_name: string;
  subject_dob: string | null;
  status: CaseStatus;
  lead_user_id: string | null;
  lead_user_name?: string | null;
  confidentiality: CaseConfidentiality;
  metadata: Record<string, unknown>;
  /** The organization's own fields (settings.cases.customFields); inside `enc` when the case is encrypted. */
  custom?: Record<string, unknown>;
  /** Set when the case is encrypted: the sensitive fields as a sealed envelope (caseVault.ts). */
  enc?: Envelope | null;
  encrypted?: boolean;
  /** The caller's wrapped case key, in lists, so the browser opens every case without a request each. */
  my_key?: string | null;
  /** Browser only: an encrypted case that could not be opened (locked or no key). */
  vault_locked?: boolean;
  created_at: string;
  updated_at: string;
  document_count?: number;
  interview_count?: number;
  assessment_count?: number;
}

export interface CaseDocument {
  id: string;
  case_id: string;
  document_id: string | null;
  title: string;
  category: CaseDocumentCategory;
  extracted_text: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  /** The file's own key (base64), sealed in `enc`; the stored file is ciphertext under it. */
  file_key?: string | null;
  enc?: Envelope | null;
}

export interface CaseInterview {
  id: string;
  case_id: string;
  interviewee_name: string;
  interviewee_role: CaseIntervieweeRole;
  interview_date: string;
  duration_minutes: number;
  interviewer_user_id: string | null;
  interviewer_name?: string | null;
  has_audio: boolean;
  revision: string;
  transcript_stale: boolean;
  summary_stale: boolean;
  transcript_text: string;
  summary: string | null;
  tags: string[];
  /** Encrypted audio: its real type (the stored file is ciphertext), inside `enc`. */
  audio_mime?: string | null;
  /** The audio's own key (base64), sealed in `enc`; the stored audio is ciphertext under it. */
  audio_key?: string | null;
  enc?: Envelope | null;
  created_at: string;
}

export interface Assessment {
  id: string;
  case_id: string;
  template_id: string;
  title: string;
  status: AssessmentStatus;
  sections_content: Record<string, string>;
  custom?: Record<string, unknown>;
  enc?: Envelope | null;
  author_user_id: string | null;
  author_name?: string | null;
  final_document_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  template_name?: string;
  template_domain?: string;
}

export interface CreateCaseDto {
  reference_number: string;
  title: string;
  domain?: CaseDomain;
  subject_name: string;
  subject_dob?: string | null;
  lead_user_id?: string | null;
  confidentiality?: CaseConfidentiality;
  metadata?: Record<string, unknown>;
  custom?: Record<string, unknown>;
  /** Encrypted case: the client's id (it is part of the sealing), the sealed fields and the first key. */
  id?: string;
  enc?: Envelope;
  wrappedKey?: string;
}

export interface UpdateCaseDto {
  reference_number?: string;
  title?: string;
  domain?: CaseDomain;
  subject_name?: string;
  subject_dob?: string | null;
  status?: CaseStatus;
  lead_user_id?: string | null;
  confidentiality?: CaseConfidentiality;
  metadata?: Record<string, unknown>;
  custom?: Record<string, unknown>;
  enc?: Envelope;
}

export interface CreateCaseDocumentDto {
  title: string;
  category?: CaseDocumentCategory;
  document_id?: string | null;
  extracted_text?: string | null;
  metadata?: Record<string, unknown>;
  /** Encrypted case: the client's id (part of the sealing) and the sealed fields. */
  id?: string;
  enc?: Envelope;
}

export interface CreateCaseInterviewDto {
  interviewee_name: string;
  interviewee_role?: CaseIntervieweeRole;
  interview_date?: string;
  duration_minutes?: number;
  interviewer_user_id?: string | null;
  transcript_text?: string;
  summary?: string | null;
  tags?: string[];
  id?: string;
  enc?: Envelope;
}

export interface CreateAssessmentDto {
  template_id: string;
  title: string;
  sections_content?: Record<string, string>;
  custom?: Record<string, unknown>;
  id?: string;
  enc?: Envelope;
}

export interface UpdateAssessmentDto {
  title?: string;
  status?: AssessmentStatus;
  sections_content?: Record<string, string>;
  custom?: Record<string, unknown>;
  enc?: Envelope;
}

export interface CreateAssessmentTemplateDto {
  name: string;
  domain?: CaseDomain;
  description?: string | null;
  sections: AssessmentTemplateSection[];
  letterhead_config?: Record<string, unknown>;
  ai_allowed?: boolean;
}

export interface UpdateAssessmentTemplateDto {
  name?: string;
  domain?: CaseDomain;
  description?: string | null;
  sections?: AssessmentTemplateSection[];
  letterhead_config?: Record<string, unknown>;
  ai_allowed?: boolean;
}

// Helpers
export function isValidCaseDomain(domain: string): domain is CaseDomain {
  return (CASE_DOMAINS as readonly string[]).includes(domain as CaseDomain);
}

export function isValidCaseStatus(status: string): status is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(status as CaseStatus);
}

export function isValidCaseConfidentiality(c: string): c is CaseConfidentiality {
  return (CASE_CONFIDENTIALITIES as readonly string[]).includes(c as CaseConfidentiality);
}

export function isValidDocumentCategory(c: string): c is CaseDocumentCategory {
  return (CASE_DOCUMENT_CATEGORIES as readonly string[]).includes(c as CaseDocumentCategory);
}

export function isValidIntervieweeRole(r: string): r is CaseIntervieweeRole {
  return (CASE_INTERVIEWEE_ROLES as readonly string[]).includes(r as CaseIntervieweeRole);
}

export function isValidAssessmentStatus(s: string): s is AssessmentStatus {
  return (ASSESSMENT_STATUSES as readonly string[]).includes(s as AssessmentStatus);
}

// AI providers per organization (organizations.settings.cases.ai), set by a superdeveloper only.
// Azure calls are paid and go through the API's budget (ai-budget.service.ts): the instance's
// AI_MONTHLY_BUDGET_CHF and the organization's limit (settings.ai, packages/shared/src/ai.ts).

/** An interview's audio: at most what Azure OpenAI Whisper takes in one request (25 MB). */
export const MAX_INTERVIEW_AUDIO_BYTES = 25_000_000;
/** The same audio sealed in the browser (an encrypted case): AES-GCM adds its nonce and tag. */
export const MAX_SEALED_INTERVIEW_AUDIO_BYTES = MAX_INTERVIEW_AUDIO_BYTES + 1024;

/** Who transcribes interview audio: Azure OpenAI Whisper (Switzerland), or nobody (typed notes only). */
export const CASE_AI_TRANSCRIPTION = ['azure', 'off'] as const;
export type CaseAiTranscription = (typeof CASE_AI_TRANSCRIPTION)[number];
/** Who drafts an interview summary: no model (key sentences), the instance's provider (Gemini/OpenAI), or Azure OpenAI. */
export const CASE_AI_SUMMARY = ['local', 'instance', 'azure'] as const;
export type CaseAiSummary = (typeof CASE_AI_SUMMARY)[number];
/** Who writes an assessment's AI draft (the template must still allow it): the instance's provider or Azure OpenAI. */
export const CASE_AI_DRAFT = ['instance', 'azure'] as const;
export type CaseAiDraft = (typeof CASE_AI_DRAFT)[number];
export interface CaseAiSettings {
  transcription: CaseAiTranscription;
  summary: CaseAiSummary;
  draft: CaseAiDraft;
}

/**
 * What an organization gets until a superdeveloper changes it: transcription by Azure (capped by the
 * organization's and the instance's AI budget), summaries as key sentences without a model. A stored
 * value no longer offered (the server Whisper this replaced) reads as the default.
 */
export const DEFAULT_CASE_AI_SETTINGS: CaseAiSettings = { transcription: 'azure', summary: 'local', draft: 'instance' };

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** The stored settings with defaults for anything missing or invalid (reading never fails). */
export function parseCaseAiSettings(raw: unknown): CaseAiSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    transcription: isOneOf(CASE_AI_TRANSCRIPTION, o.transcription) ? o.transcription : DEFAULT_CASE_AI_SETTINGS.transcription,
    summary: isOneOf(CASE_AI_SUMMARY, o.summary) ? o.summary : DEFAULT_CASE_AI_SETTINGS.summary,
    draft: isOneOf(CASE_AI_DRAFT, o.draft) ? o.draft : DEFAULT_CASE_AI_SETTINGS.draft,
  };
}

/** Checks a complete settings object as sent by the browser; the error is an i18n-able kebab code. */
export function validateCaseAiSettings(raw: unknown): { ok: true; value: CaseAiSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_TRANSCRIPTION, o.transcription)) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_SUMMARY, o.summary)) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_DRAFT, o.draft)) return { ok: false, error: 'ai-settings-invalid' };
  return { ok: true, value: { transcription: o.transcription, summary: o.summary, draft: o.draft } };
}

// Custom fields: an organization's own fields on cases and assessments (organizations.settings.cases.customFields).
// The definitions are plain settings; the values live in the row's `custom` JSON, which for an encrypted case is
// sealed inside `enc` (so the server cannot check them there: the browser does, with the same functions).

export const CUSTOM_FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'select'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_TARGETS = ['case', 'assessment'] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

export interface CaseCustomField {
  key: string;
  target: CustomFieldTarget;
  label: string;
  type: CustomFieldType;
  /** For `select`. */
  options?: string[];
}

const FIELD_KEY = /^[a-z][a-zA-Z0-9_]{0,39}$/;

/** Checks the definitions as sent by the settings page; the error is a kebab code. */
export function validateCustomFieldDefs(raw: unknown): { ok: true; value: CaseCustomField[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length > 40) return { ok: false, error: 'custom-fields-invalid' };
  const seen = new Set<string>();
  const value: CaseCustomField[] = [];
  for (const f of raw as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'custom-fields-invalid' };
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    if (typeof f.key !== 'string' || !FIELD_KEY.test(f.key) || !label || label.length > 100) return { ok: false, error: 'custom-fields-invalid' };
    if (!(CUSTOM_FIELD_TARGETS as readonly string[]).includes(f.target as string) || !(CUSTOM_FIELD_TYPES as readonly string[]).includes(f.type as string)) return { ok: false, error: 'custom-fields-invalid' };
    const id = `${f.target}:${f.key}`;
    if (seen.has(id)) return { ok: false, error: 'custom-fields-duplicate' };
    seen.add(id);
    let options: string[] | undefined;
    if (f.type === 'select') {
      options = Array.isArray(f.options) ? (f.options as unknown[]).map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean) : [];
      if (!options.length || options.length > 30 || options.some((o) => o.length > 100) || new Set(options).size !== options.length) return { ok: false, error: 'custom-fields-invalid' };
    }
    value.push({ key: f.key, target: f.target as CustomFieldTarget, label, type: f.type as CustomFieldType, ...(options ? { options } : {}) });
  }
  return { ok: true, value };
}

/** The values of one row against its definitions: null when fine, else a kebab code. Empty values are allowed. */
export function validateCustomValues(defs: readonly CaseCustomField[], target: CustomFieldTarget, values: unknown): string | null {
  if (values == null) return null;
  if (typeof values !== 'object' || Array.isArray(values)) return 'invalid-custom';
  const mine = new Map(defs.filter((d) => d.target === target).map((d) => [d.key, d]));
  for (const [key, v] of Object.entries(values as Record<string, unknown>)) {
    const def = mine.get(key);
    if (!def) return 'invalid-custom';
    if (v === null || v === '' || v === undefined) continue;
    if (def.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) return 'invalid-custom';
    if (def.type === 'date' && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'invalid-custom';
    if (def.type === 'select' && !(typeof v === 'string' && def.options?.includes(v))) return 'invalid-custom';
    if ((def.type === 'text' && !(typeof v === 'string' && v.length <= 2000)) || (def.type === 'longtext' && !(typeof v === 'string' && v.length <= 50_000))) return 'invalid-custom';
  }
  return null;
}
