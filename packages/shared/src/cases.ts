// Cases & Assessments module: Domain models, templates, and validation logic.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

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
  created_at: string;
}

export interface Assessment {
  id: string;
  case_id: string;
  template_id: string;
  title: string;
  status: AssessmentStatus;
  sections_content: Record<string, string>;
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
}

export interface CreateCaseDocumentDto {
  title: string;
  category?: CaseDocumentCategory;
  document_id?: string | null;
  extracted_text?: string | null;
  metadata?: Record<string, unknown>;
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
}

export interface CreateAssessmentDto {
  template_id: string;
  title: string;
  sections_content?: Record<string, string>;
}

export interface UpdateAssessmentDto {
  title?: string;
  status?: AssessmentStatus;
  sections_content?: Record<string, string>;
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
// AI_MONTHLY_BUDGET_CHF and this organization's monthlyLimitChf, both per calendar month.

/** Who transcribes interview audio: the server's own Whisper, or Azure AI Speech. */
export const CASE_AI_TRANSCRIPTION = ['whisper', 'azure'] as const;
export type CaseAiTranscription = (typeof CASE_AI_TRANSCRIPTION)[number];
/** Who drafts an interview summary: no model (key sentences), the instance's provider (Gemini/OpenAI), or Azure OpenAI. */
export const CASE_AI_SUMMARY = ['local', 'instance', 'azure'] as const;
export type CaseAiSummary = (typeof CASE_AI_SUMMARY)[number];
/** Who writes an assessment's AI draft (the template must still allow it): the instance's provider or Azure OpenAI. */
export const CASE_AI_DRAFT = ['instance', 'azure'] as const;
export type CaseAiDraft = (typeof CASE_AI_DRAFT)[number];
/** Largest per-organization monthly limit that can be set, in CHF. */
export const CASE_AI_MAX_MONTHLY_LIMIT_CHF = 1000;

export interface CaseAiSettings {
  transcription: CaseAiTranscription;
  summary: CaseAiSummary;
  draft: CaseAiDraft;
  /** Azure spend allowed per calendar month for this organization, CHF. */
  monthlyLimitChf: number;
}

/** What an organization gets until a superdeveloper changes it: nothing leaves the server for Azure. */
export const DEFAULT_CASE_AI_SETTINGS: CaseAiSettings = { transcription: 'whisper', summary: 'local', draft: 'instance', monthlyLimitChf: 10 };

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= CASE_AI_MAX_MONTHLY_LIMIT_CHF;
}

/** The stored settings with defaults for anything missing or invalid (reading never fails). */
export function parseCaseAiSettings(raw: unknown): CaseAiSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    transcription: isOneOf(CASE_AI_TRANSCRIPTION, o.transcription) ? o.transcription : DEFAULT_CASE_AI_SETTINGS.transcription,
    summary: isOneOf(CASE_AI_SUMMARY, o.summary) ? o.summary : DEFAULT_CASE_AI_SETTINGS.summary,
    draft: isOneOf(CASE_AI_DRAFT, o.draft) ? o.draft : DEFAULT_CASE_AI_SETTINGS.draft,
    monthlyLimitChf: isLimit(o.monthlyLimitChf) ? o.monthlyLimitChf : DEFAULT_CASE_AI_SETTINGS.monthlyLimitChf,
  };
}

/** Checks a complete settings object as sent by the browser; the error is an i18n-able kebab code. */
export function validateCaseAiSettings(raw: unknown): { ok: true; value: CaseAiSettings } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_TRANSCRIPTION, o.transcription)) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_SUMMARY, o.summary)) return { ok: false, error: 'ai-settings-invalid' };
  if (!isOneOf(CASE_AI_DRAFT, o.draft)) return { ok: false, error: 'ai-settings-invalid' };
  if (!isLimit(o.monthlyLimitChf)) return { ok: false, error: 'ai-settings-limit' };
  return { ok: true, value: { transcription: o.transcription, summary: o.summary, draft: o.draft, monthlyLimitChf: Math.round(o.monthlyLimitChf * 100) / 100 } };
}
