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
  audio_document_id: string | null;
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
  audio_document_id?: string | null;
  transcript_text: string;
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
}

export interface UpdateAssessmentTemplateDto {
  name?: string;
  domain?: CaseDomain;
  description?: string | null;
  sections?: AssessmentTemplateSection[];
  letterhead_config?: Record<string, unknown>;
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
