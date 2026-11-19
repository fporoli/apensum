import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from '@worktime3/web/plugin';
import { CaseInterviewAudioInput } from './CaseInterviewAudioInput';
import { CaseInterviewEditor, caseErrorText, interviewError, interviewResponse, type InterviewAiProviders } from './CaseInterviewEditor';
import { PageHeader, EmptyState } from '@worktime3/web/plugin';
import {
  AddIcon,
  ArticleIcon,
  CloseIcon,
  DeleteIcon,
  DescriptionIcon,
  DownloadIcon,
  EditIcon,
  FolderSharedIcon,
  SaveIcon,
  SearchIcon,
  UploadIcon,
} from '@worktime3/web/plugin';
import type {
  Case,
  CaseDocument,
  CaseInterview,
  Assessment,
  AssessmentTemplate,
  AssessmentTemplateSection,
  CaseDomain,
  CaseStatus,
  CaseConfidentiality,
  CaseDocumentCategory,
  CaseIntervieweeRole,
} from '../shared/cases';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export default function Cases({
  orgId,
  authHeaders,
  canEdit = true,
}: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit?: boolean;
}) {
  const { t } = useI18n();

  // Navigation & selection
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // Active dossier sub-view
  const [activeTab, setActiveTab] = useState(0);

  // Modals state
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [createCaseError, setCreateCaseError] = useState<string | null>(null);
  const [creatingCase, setCreatingCase] = useState(false);
  const [newCaseData, setNewCaseData] = useState({
    reference_number: '',
    title: '',
    domain: 'kesb' as CaseDomain,
    subject_name: '',
    subject_dob: '',
    confidentiality: 'standard' as CaseConfidentiality,
  });

  // Load cases
  const loadCases = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (domainFilter !== 'all') params.set('domain', domainFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`${API}/organizations/${orgId}/cases?${params.toString()}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data?.ok) {
        setCases(data.cases ?? []);
        setError(null);
      } else {
        setError(data?.error ?? 'failed-to-load-cases');
      }
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [orgId, authHeaders, domainFilter, statusFilter, search, t]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  const closeCreateCase = () => {
    if (creatingCase) return;
    setCreateCaseError(null);
    setCreateCaseOpen(false);
  };

  const handleCreateCase = async () => {
    if (creatingCase || !newCaseData.reference_number.trim() || !newCaseData.title.trim() || !newCaseData.subject_name.trim()) return;
    setCreateCaseError(null);
    setCreatingCase(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/cases`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newCaseData,
          subject_dob: newCaseData.subject_dob || null,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        setCreateCaseOpen(false);
        setNewCaseData({
          reference_number: '',
          title: '',
          domain: 'kesb',
          subject_name: '',
          subject_dob: '',
          confidentiality: 'standard',
        });
        await loadCases();
        if (data.case?.id) setSelectedCaseId(data.case.id);
      } else {
        setCreateCaseError(data?.message ?? t('cases.modal.createError'));
      }
    } catch {
      setCreateCaseError(t('common.cannotReachApi'));
    } finally {
      setCreatingCase(false);
    }
  };

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {!selectedCase ? (
        // ---------------------------------------------------------------------
        // Case Dossiers List View
        // ---------------------------------------------------------------------
        <Box>
          <PageHeader
            title={t('cases.title')}
            subtitle={t('cases.subtitle')}
            end={
              canEdit && (
                <Button
                  variant="contained"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => setCreateCaseOpen(true)}
                >
                  {t('cases.newCase')}
                </Button>
              )
            }
          />

          {error && (
            <Alert severity="error" sx={{ my: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Filter Bar */}
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ my: 2, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <TextField
              size="small"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 260 }}
            />

            <TextField
              select
              size="small"
              label={t('cases.filterDomain')}
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="all">{t('cases.domain.all')}</MenuItem>
              <MenuItem value="kesb">{t('cases.domain.kesb')}</MenuItem>
              <MenuItem value="forensic_psychiatry">{t('cases.domain.forensic_psychiatry')}</MenuItem>
              <MenuItem value="police">{t('cases.domain.police')}</MenuItem>
              <MenuItem value="social">{t('cases.domain.social')}</MenuItem>
              <MenuItem value="custom">{t('cases.domain.custom')}</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label={t('cases.filterStatus')}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="all">{t('cases.status.all')}</MenuItem>
              <MenuItem value="open">{t('cases.status.open')}</MenuItem>
              <MenuItem value="in_progress">{t('cases.status.in_progress')}</MenuItem>
              <MenuItem value="review">{t('cases.status.review')}</MenuItem>
              <MenuItem value="completed">{t('cases.status.completed')}</MenuItem>
              <MenuItem value="archived">{t('cases.status.archived')}</MenuItem>
            </TextField>
          </Stack>

          {/* Cases Grid */}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
              <CircularProgress />
            </Box>
          ) : cases.length === 0 ? (
            <EmptyState
              title={t('cases.noCasesTitle')}
              description={t('cases.noCasesDescription')}
              action={
                canEdit ? (
                  <Button variant="contained" onClick={() => setCreateCaseOpen(true)}>
                    {t('cases.newCase')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Grid container spacing={2}>
              {cases.map((c) => (
                <Grid item xs={12} sm={6} md={4} key={c.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                      '&:hover': {
                        borderColor: 'primary.main',
                        boxShadow: 2,
                      },
                    }}
                    onClick={() => {
                      setSelectedCaseId(c.id);
                      setActiveTab(0);
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.5 }}>
                          {c.reference_number}
                        </Typography>
                        <Chip
                          size="small"
                          label={t(`cases.status.${c.status}`)}
                          color={
                            c.status === 'completed'
                              ? 'success'
                              : c.status === 'in_progress'
                                ? 'primary'
                                : c.status === 'review'
                                  ? 'warning'
                                  : 'default'
                          }
                          variant="outlined"
                        />
                      </Box>

                      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }} noWrap>
                        {c.title}
                      </Typography>

                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {t('cases.subject')}: <strong>{c.subject_name}</strong>
                        {c.subject_dob ? ` (*${c.subject_dob})` : ''}
                      </Typography>

                      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                        <Chip size="small" label={t(`cases.domain.${c.domain}`)} />
                        {c.confidentiality === 'strictly_confidential' && (
                          <Chip size="small" label={t('cases.confidentiality.strictly_confidential')} color="error" variant="outlined" />
                        )}
                      </Stack>

                      <Divider sx={{ my: 1 }} />

                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          {c.lead_user_name ?? t('cases.unassigned')}
                        </Typography>
                        <Stack direction="row" spacing={1.5}>
                          <Tooltip title={t('cases.tab.documents')}>
                            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <DescriptionIcon fontSize="inherit" /> {c.document_count ?? 0}
                            </Typography>
                          </Tooltip>
                          <Tooltip title={t('cases.tab.interviews')}>
                            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <FolderSharedIcon fontSize="inherit" /> {c.interview_count ?? 0}
                            </Typography>
                          </Tooltip>
                          <Tooltip title={t('cases.tab.assessments')}>
                            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <ArticleIcon fontSize="inherit" /> {c.assessment_count ?? 0}
                            </Typography>
                          </Tooltip>
                        </Stack>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {/* Create Case Modal */}
          <Dialog open={createCaseOpen} onClose={closeCreateCase} maxWidth="sm" fullWidth>
            <DialogTitle>{t('cases.modal.createTitle')}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {createCaseError && <Alert severity="error">{createCaseError}</Alert>}
                <TextField
                  label={t('cases.reference_number')}
                  required
                  placeholder="e.g. KESB-2026-089"
                  value={newCaseData.reference_number}
                  onChange={(e) => setNewCaseData({ ...newCaseData, reference_number: e.target.value })}
                />
                <TextField
                  label={t('cases.caseTitle')}
                  required
                  placeholder="e.g. Abklärung Gefährdungsmeldung"
                  value={newCaseData.title}
                  onChange={(e) => setNewCaseData({ ...newCaseData, title: e.target.value })}
                />
                <TextField
                  select
                  label={t('cases.domain')}
                  value={newCaseData.domain}
                  onChange={(e) => setNewCaseData({ ...newCaseData, domain: e.target.value as CaseDomain })}
                >
                  <MenuItem value="kesb">{t('cases.domain.kesb')}</MenuItem>
                  <MenuItem value="forensic_psychiatry">{t('cases.domain.forensic_psychiatry')}</MenuItem>
                  <MenuItem value="police">{t('cases.domain.police')}</MenuItem>
                  <MenuItem value="social">{t('cases.domain.social')}</MenuItem>
                  <MenuItem value="custom">{t('cases.domain.custom')}</MenuItem>
                </TextField>
                <TextField
                  label={t('cases.subject_name')}
                  required
                  placeholder="e.g. Max Muster"
                  value={newCaseData.subject_name}
                  onChange={(e) => setNewCaseData({ ...newCaseData, subject_name: e.target.value })}
                />
                <TextField
                  label={t('cases.subject_dob')}
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={newCaseData.subject_dob}
                  onChange={(e) => setNewCaseData({ ...newCaseData, subject_dob: e.target.value })}
                />
                <TextField
                  select
                  label={t('cases.confidentiality')}
                  value={newCaseData.confidentiality}
                  onChange={(e) =>
                    setNewCaseData({ ...newCaseData, confidentiality: e.target.value as CaseConfidentiality })
                  }
                >
                  <MenuItem value="standard">{t('cases.confidentiality.standard')}</MenuItem>
                  <MenuItem value="confidential">{t('cases.confidentiality.confidential')}</MenuItem>
                  <MenuItem value="strictly_confidential">
                    {t('cases.confidentiality.strictly_confidential')} (Art. 321 StGB)
                  </MenuItem>
                </TextField>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeCreateCase} disabled={creatingCase}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                onClick={handleCreateCase}
                disabled={
                  creatingCase ||
                  !newCaseData.reference_number.trim() ||
                  !newCaseData.title.trim() ||
                  !newCaseData.subject_name.trim()
                }
              >
                {t('common.create')}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      ) : (
        // ---------------------------------------------------------------------
        // Case Dossier Detailed Workspace
        // ---------------------------------------------------------------------
        <CaseDossierWorkspace
          orgId={orgId}
          caseItem={selectedCase}
          authHeaders={authHeaders}
          canEdit={canEdit}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onBack={() => {
            setSelectedCaseId(null);
            void loadCases();
          }}
          onRefreshCase={async () => {
            await loadCases();
          }}
        />
      )}
    </Box>
  );
}

// =============================================================================
// Case Dossier Detailed Workspace Component
// =============================================================================

function CaseDossierWorkspace({
  orgId,
  caseItem,
  authHeaders,
  canEdit,
  activeTab,
  setActiveTab,
  onBack,
  onRefreshCase,
}: {
  orgId: string;
  caseItem: Case;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  activeTab: number;
  setActiveTab: (t: number) => void;
  onBack: () => void;
  onRefreshCase: () => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <Box>
      {/* Dossier Header */}
      <Box sx={{ mb: 3 }}>
        <Button onClick={onBack} sx={{ mb: 1 }} size="small">
          ← {t('cases.backToList')}
        </Button>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="overline" sx={{ fontWeight: 800, color: 'primary.main', fontSize: '0.85rem' }}>
                {caseItem.reference_number}
              </Typography>
              <Chip size="small" label={t(`cases.status.${caseItem.status}`)} color="primary" variant="outlined" />
              {caseItem.confidentiality === 'strictly_confidential' && (
                <Chip
                  size="small"
                  label={t('cases.confidentiality.strictly_confidential')}
                  color="error"
                  variant="outlined"
                />
              )}
            </Stack>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
              {caseItem.title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('cases.subject')}: <strong>{caseItem.subject_name}</strong>
              {caseItem.subject_dob ? ` (*${caseItem.subject_dob})` : ''} • {t('cases.domain')}:{' '}
              {t(`cases.domain.${caseItem.domain}`)} • {t('cases.lead')}:{' '}
              {caseItem.lead_user_name ?? t('cases.unassigned')}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, val) => setActiveTab(val)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
      >
        <Tab label={t('cases.tab.overview')} />
        <Tab label={`${t('cases.tab.documents')} (${caseItem.document_count ?? 0})`} />
        <Tab label={`${t('cases.tab.interviews')} (${caseItem.interview_count ?? 0})`} />
        <Tab label={`${t('cases.tab.assessments')} (${caseItem.assessment_count ?? 0})`} />
      </Tabs>

      {/* Tab Panels */}
      {activeTab === 0 && (
        <CaseOverviewTab
          orgId={orgId}
          caseItem={caseItem}
          authHeaders={authHeaders}
          canEdit={canEdit}
          onRefresh={onRefreshCase}
          onJumpToTab={setActiveTab}
        />
      )}
      {activeTab === 1 && (
        <CaseDocumentsTab
          orgId={orgId}
          caseId={caseItem.id}
          authHeaders={authHeaders}
          canEdit={canEdit}
          onRefreshCase={onRefreshCase}
        />
      )}
      {activeTab === 2 && (
        <CaseInterviewsTab
          key={`${orgId}:${caseItem.id}`}
          orgId={orgId}
          caseId={caseItem.id}
          authHeaders={authHeaders}
          canEdit={canEdit}
          onRefreshCase={onRefreshCase}
        />
      )}
      {activeTab === 3 && (
        <CaseAssessmentsTab
          orgId={orgId}
          caseItem={caseItem}
          authHeaders={authHeaders}
          canEdit={canEdit}
          onRefreshCase={onRefreshCase}
        />
      )}
    </Box>
  );
}

/** Assessment templates as their own page (navbar Cases -> Assessment Templates), not per case. */
export function AssessmentTemplates({ orgId, authHeaders, canEdit }: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
}) {
  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <CaseTemplatesTab orgId={orgId} authHeaders={authHeaders} canEdit={canEdit} />
    </Box>
  );
}

// =============================================================================
// Tab 0: Case Overview
// =============================================================================

function CaseOverviewTab({
  orgId,
  caseItem,
  authHeaders,
  canEdit,
  onRefresh,
  onJumpToTab,
}: {
  orgId: string;
  caseItem: Case;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
  onJumpToTab: (idx: number) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState(caseItem.status);
  const [updating, setUpdating] = useState(false);

  const handleStatusChange = async (newStatus: CaseStatus) => {
    setStatus(newStatus);
    setUpdating(true);
    try {
      await fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}`, {
        method: 'PATCH',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      await onRefresh();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={8}>
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              {t('cases.overview.dossierDetails')}
            </Typography>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.reference_number')}
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {caseItem.reference_number}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.domain')}
                </Typography>
                <Typography variant="body1">
                  {t(`cases.domain.${caseItem.domain}`)}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.subject_name')}
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  {caseItem.subject_name}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.subject_dob')}
                </Typography>
                <Typography variant="body1">
                  {caseItem.subject_dob ?? t('common.notSpecified')}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.lead')}
                </Typography>
                <Typography variant="body1">
                  {caseItem.lead_user_name ?? t('cases.unassigned')}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Typography variant="caption" color="text.secondary">
                  {t('cases.confidentiality')}
                </Typography>
                <Typography variant="body1">
                  {t(`cases.confidentiality.${caseItem.confidentiality}`)}
                </Typography>
              </Grid>
            </Grid>

            {caseItem.confidentiality === 'strictly_confidential' && (
              <Alert severity="warning" sx={{ mt: 3 }}>
                <strong>{t('cases.warning.professionalSecrecy')}</strong> (Art. 321 StGB).{' '}
                {t('cases.warning.professionalSecrecyDetails')}
              </Alert>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              {t('cases.overview.workflowStatus')}
            </Typography>
            <TextField
              select
              fullWidth
              size="small"
              label={t('cases.status')}
              value={status}
              disabled={!canEdit || updating}
              onChange={(e) => handleStatusChange(e.target.value as CaseStatus)}
              sx={{ mb: 2 }}
            >
              <MenuItem value="open">{t('cases.status.open')}</MenuItem>
              <MenuItem value="in_progress">{t('cases.status.in_progress')}</MenuItem>
              <MenuItem value="review">{t('cases.status.review')}</MenuItem>
              <MenuItem value="completed">{t('cases.status.completed')}</MenuItem>
              <MenuItem value="archived">{t('cases.status.archived')}</MenuItem>
            </TextField>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t('cases.overview.quickActions')}
            </Typography>
            <Stack spacing={1}>
              <Button
                variant="outlined"
                startIcon={<DescriptionIcon fontSize="small" />}
                onClick={() => onJumpToTab(1)}
                fullWidth
              >
                {t('cases.action.addDocument')}
              </Button>
              <Button
                variant="outlined"
                startIcon={<FolderSharedIcon fontSize="small" />}
                onClick={() => onJumpToTab(2)}
                fullWidth
              >
                {t('cases.action.addInterview')}
              </Button>
              <Button
                variant="contained"
                startIcon={<ArticleIcon fontSize="small" />}
                onClick={() => onJumpToTab(3)}
                fullWidth
              >
                {t('cases.action.generateAssessment')}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

// =============================================================================
// Tab 1: Documents & Evidence
// =============================================================================

function CaseDocumentsTab({
  orgId,
  caseId,
  authHeaders,
  canEdit,
  onRefreshCase,
}: {
  orgId: string;
  caseId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onRefreshCase: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // After an upload: a PDF without a text layer (a scan) gave no text for the drafts.
  const [notice, setNotice] = useState<string | null>(null);

  // Upload modal
  const [openUpload, setOpenUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<CaseDocumentCategory>('evidence');
  const [extractedText, setExtractedText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Preview extracted text modal
  const [previewDoc, setPreviewDoc] = useState<CaseDocument | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/organizations/${orgId}/cases/${caseId}/documents`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data?.ok) setDocs(data.documents ?? []);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [orgId, caseId, authHeaders, t]);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const handleUpload = async () => {
    if (!title.trim() && !selectedFile) return;
    try {
      setSaving(true);
      const formData = new FormData();
      formData.set('title', title.trim() || selectedFile?.name || 'Document');
      formData.set('category', category);
      if (extractedText.trim()) formData.set('extracted_text', extractedText.trim());
      if (selectedFile) formData.set('file', selectedFile);

      const headers = await authHeaders();
      // Drop content-type header so browser sets multipart boundary
      delete headers['Content-Type'];
      delete headers['content-type'];

      const res = await fetch(`${API}/organizations/${orgId}/cases/${caseId}/documents`, {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await res.json();
      if (data?.ok) {
        setNotice(data.extraction === 'pdf-no-text' ? t('cases.documents.pdfNoText') : null);
        setOpenUpload(false);
        setTitle('');
        setCategory('evidence');
        setExtractedText('');
        setSelectedFile(null);
        await loadDocs();
        await onRefreshCase();
      } else {
        setError(data?.error ?? 'failed-to-upload');
      }
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try {
      await fetch(`${API}/organizations/${orgId}/cases/${caseId}/documents/${docId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      await loadDocs();
      await onRefreshCase();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('cases.documents.title')}
        </Typography>
        {canEdit && (
          <Button
            variant="contained"
            startIcon={<UploadIcon fontSize="small" />}
            onClick={() => setOpenUpload(true)}
          >
            {t('cases.documents.uploadEvidence')}
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {loading ? (
        <CircularProgress />
      ) : docs.length === 0 ? (
        <EmptyState
          title={t('cases.documents.noDocsTitle')}
          description={t('cases.documents.noDocsDescription')}
        />
      ) : (
        <Stack spacing={2}>
          {docs.map((d) => (
            <Card key={d.id} variant="outlined">
              <CardContent sx={{ pb: '16px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {d.title}
                      </Typography>
                      <Chip size="small" label={t(`cases.docCategory.${d.category}`)} variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {d.file_name ? `Datei: ${d.file_name} • ` : ''}
                      Erfasst: {d.created_at.slice(0, 10)}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    {d.extracted_text && (
                      <Button size="small" variant="outlined" onClick={() => setPreviewDoc(d)}>
                        {t('cases.documents.viewExtractedText')}
                      </Button>
                    )}
                    {canEdit && (
                      <IconButton size="small" color="error" onClick={() => handleDelete(d.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </Box>

                {d.extracted_text && (
                  <Box sx={{ mt: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="body2" sx={{ fontStyle: 'italic' }} noWrap>
                      "{d.extracted_text.slice(0, 180)}..."
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Upload Dialog */}
      <Dialog open={openUpload} onClose={() => setOpenUpload(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('cases.documents.uploadModalTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('cases.documents.docTitle')}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Psychiatrischer Verlaufsbericht"
            />
            <TextField
              select
              label={t('cases.documents.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value as CaseDocumentCategory)}
            >
              <MenuItem value="court_decree">{t('cases.docCategory.court_decree')}</MenuItem>
              <MenuItem value="medical">{t('cases.docCategory.medical')}</MenuItem>
              <MenuItem value="police_report">{t('cases.docCategory.police_report')}</MenuItem>
              <MenuItem value="evidence">{t('cases.docCategory.evidence')}</MenuItem>
              <MenuItem value="correspondence">{t('cases.docCategory.correspondence')}</MenuItem>
              <MenuItem value="financial">{t('cases.docCategory.financial')}</MenuItem>
              <MenuItem value="other">{t('cases.docCategory.other')}</MenuItem>
            </TextField>

            <Box sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 1, textAlign: 'center' }}>
              <input
                type="file"
                id="case-doc-file-input"
                style={{ display: 'none' }}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  if (e.target.files?.[0]) {
                    setSelectedFile(e.target.files[0]);
                    if (!title) setTitle(e.target.files[0].name.replace(/\.[^/.]+$/, ''));
                  }
                }}
              />
              <label htmlFor="case-doc-file-input">
                <Button variant="outlined" component="span" startIcon={<UploadIcon fontSize="small" />}>
                  {selectedFile ? selectedFile.name : t('cases.documents.chooseFile')}
                </Button>
              </label>
            </Box>

            <TextField
              label={t('cases.documents.extractedText')}
              multiline
              rows={4}
              placeholder={t('cases.documents.extractedTextPlaceholder')}
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              helperText={t('cases.documents.extractedTextHelp')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenUpload(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpload} disabled={saving || (!title && !selectedFile)}>
            {saving ? <CircularProgress size={20} /> : t('common.upload')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Extracted Text Preview Dialog */}
      <Dialog open={!!previewDoc} onClose={() => setPreviewDoc(null)} maxWidth="md" fullWidth>
        <DialogTitle>{previewDoc?.title} — {t('cases.documents.extractedText')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {previewDoc?.extracted_text}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewDoc(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// =============================================================================
// Tab 2: Interviews & Transcripts
// =============================================================================

function CaseInterviewsTab({
  orgId,
  caseId,
  authHeaders,
  canEdit,
  onRefreshCase,
}: {
  orgId: string;
  caseId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onRefreshCase: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [interviews, setInterviews] = useState<CaseInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New interview modal
  const [openModal, setOpenModal] = useState(false);
  const [intervieweeName, setIntervieweeName] = useState('');
  const [role, setRole] = useState<CaseIntervieweeRole>('subject');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState(45);
  const [summary, setSummary] = useState('');
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [createError, setCreateError] = useState('');
  const [editable, setEditable] = useState(false);
  const mayEdit = canEdit && editable;
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [aiProviders, setAiProviders] = useState<InterviewAiProviders>({ transcription: null, transcriptionSetting: 'whisper', summary: 'local' });
  const endpoint = `${API}/organizations/${orgId}/cases/${caseId}/interviews`;

  // Transcript inspect modal
  const [selectedInterview, setSelectedInterview] = useState<CaseInterview | null>(null);

  const loadInterviews = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(endpoint, {
        headers: await authHeaders(),
      });
      const data = await interviewResponse(res);
      setInterviews(data.interviews ?? []);
      setEditable(data.editable === true);
      setTranscriptionEnabled(data.transcriptionEnabled === true);
      setAiProviders({
        transcription: data.transcriptionProvider ?? null,
        transcriptionSetting: data.transcriptionSetting === 'azure' ? 'azure' : 'whisper',
        summary: data.summaryProvider === undefined ? 'local' : data.summaryProvider,
      });
    } catch (error) {
      setEditable(false);
      setInterviews([]);
      setError(interviewError(error, t));
    } finally {
      setLoading(false);
    }
  }, [endpoint, authHeaders, t]);

  useEffect(() => {
    void loadInterviews();
  }, [loadInterviews]);

  const closeCreate = () => {
    if (saving || recording) return;
    setCreateError('');
    setAudioFile(null);
    setOpenModal(false);
  };

  const handleCreate = async () => {
    if (!intervieweeName.trim() || saving || recording) return;
    try {
      setSaving(true);
      setCreateError('');
      const form = new FormData();
      form.append('data', JSON.stringify({
        interviewee_name: intervieweeName.trim(),
        interviewee_role: role,
        interview_date: date || undefined,
        duration_minutes: duration,
        summary: summary.trim() || null,
        transcript_text: transcript.trim(),
      }));
      if (audioFile) form.append('file', audioFile);
      const { interview } = await interviewResponse(await fetch(endpoint, { method: 'POST', headers: await authHeaders(), body: form }));
      setOpenModal(false);
      setIntervieweeName('');
      setSummary('');
      setTranscript('');
      setAudioFile(null);
      setSelectedInterview(interview);
      await loadInterviews();
      await onRefreshCase();
    } catch (error) {
      setCreateError(interviewError(error, t));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try {
      await interviewResponse(await fetch(`${endpoint}/${id}`, { method: 'DELETE', headers: await authHeaders() }));
      await loadInterviews();
      await onRefreshCase();
    } catch (error) {
      setError(interviewError(error, t));
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('cases.interviews.title')}
        </Typography>
        {mayEdit && (
          <Button
            variant="contained"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => setOpenModal(true)}
          >
            {t('cases.interviews.addInterview')}
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <CircularProgress />
      ) : interviews.length === 0 ? (
        <EmptyState
          title={t('cases.interviews.noInterviewsTitle')}
          description={t('cases.interviews.noInterviewsDescription')}
        />
      ) : (
        <Stack spacing={2}>
          {interviews.map((inv) => (
            <Card key={inv.id} variant="outlined">
              <CardContent sx={{ pb: '16px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {inv.interviewee_name}
                      </Typography>
                      <Chip size="small" label={t(`cases.interviewRole.${inv.interviewee_role}`)} />
                      <Chip size="small" label={`${inv.duration_minutes} min`} variant="outlined" />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t('cases.interviews.date')}: {inv.interview_date} • {t('cases.interviews.interviewer')}:{' '}
                      {inv.interviewer_name ?? t('cases.unassigned')}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="outlined" onClick={() => setSelectedInterview(inv)}>
                      {t('cases.interviews.openInterview')}
                    </Button>
                    {mayEdit && (
                      <IconButton size="small" color="error" onClick={() => handleDelete(inv.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </Box>

                {(inv.transcript_stale || inv.summary_stale) && (
                  <Alert severity="warning" sx={{ mt: 1 }}>{t('cases.interviews.outputsStale')}</Alert>
                )}
                {inv.summary && (
                  <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    <strong>{t('cases.interviews.summary')}:</strong> {inv.summary}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Add Interview Modal */}
      <Dialog open={openModal} onClose={closeCreate} maxWidth="md" fullWidth>
        <DialogTitle>{t('cases.interviews.modalTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('cases.interviews.intervieweeName')}
                  required
                  fullWidth
                  value={intervieweeName}
                  onChange={(e) => setIntervieweeName(e.target.value)}
                  placeholder="e.g. Max Muster"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  fullWidth
                  label={t('cases.interviews.role')}
                  value={role}
                  onChange={(e) => setRole(e.target.value as CaseIntervieweeRole)}
                >
                  <MenuItem value="subject">{t('cases.interviewRole.subject')}</MenuItem>
                  <MenuItem value="witness">{t('cases.interviewRole.witness')}</MenuItem>
                  <MenuItem value="relative">{t('cases.interviewRole.relative')}</MenuItem>
                  <MenuItem value="expert">{t('cases.interviewRole.expert')}</MenuItem>
                  <MenuItem value="officer">{t('cases.interviewRole.officer')}</MenuItem>
                  <MenuItem value="informant">{t('cases.interviewRole.informant')}</MenuItem>
                  <MenuItem value="other">{t('cases.interviewRole.other')}</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('cases.interviews.date')}
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('cases.interviews.durationMinutes')}
                  type="number"
                  fullWidth
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </Grid>
            </Grid>

            <TextField
              label={t('cases.interviews.summary')}
              multiline
              rows={2}
              value={summary}
              inputProps={{ maxLength: 100_000 }}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Explorand schildert akute finanzielle Engpässe..."
            />

            <TextField
              label={t('cases.interviews.transcriptText')}
              multiline
              rows={8}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="[00:00:15] Gutachter: Guten Tag Herr Muster...\n[00:00:25] Herr Muster: Guten Tag..."
              inputProps={{ maxLength: 100_000 }}
              helperText={t('cases.interviews.transcriptHelp')}
            />
            {openModal && <CaseInterviewAudioInput file={audioFile} setFile={setAudioFile} disabled={saving} setRecording={setRecording} />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCreate} disabled={saving || recording}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreate} disabled={saving || recording || !intervieweeName.trim()}>
            {saving ? <CircularProgress size={20} /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {selectedInterview && <CaseInterviewEditor
        key={selectedInterview.id}
        interview={selectedInterview}
        url={`${endpoint}/${selectedInterview.id}`}
        authHeaders={authHeaders}
        canEdit={mayEdit}
        transcriptionEnabled={transcriptionEnabled}
        providers={aiProviders}
        onChange={(next) => {
          setSelectedInterview(next);
          setInterviews((current) => current.map((item) => item.id === next.id ? next : item));
        }}
        onClose={() => { setSelectedInterview(null); void loadInterviews(); }}
      />}
    </Box>
  );
}

// =============================================================================
// Tab 3: Assessments & Gutachten Workspace
// =============================================================================

function CaseAssessmentsTab({
  orgId,
  caseItem,
  authHeaders,
  canEdit,
  onRefreshCase,
}: {
  orgId: string;
  caseItem: Case;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onRefreshCase: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Assessment Editor
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<AssessmentTemplate | null>(null);
  const [sectionsContent, setSectionsContent] = useState<Record<string, string>>({});
  const [savingAssessment, setSavingAssessment] = useState(false);
  const [assessmentStatus, setAssessmentStatus] = useState<string>('draft');

  // Evidence panel in side-by-side view
  const [evidenceDocs, setEvidenceDocs] = useState<CaseDocument[]>([]);
  const [interviewTranscripts, setInterviewTranscripts] = useState<CaseInterview[]>([]);
  const [showEvidenceSidebar, setShowEvidenceSidebar] = useState(true);

  // Create modal
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  // Which draft is being made: the rule-based one or the AI one (null = none running).
  const [creating, setCreating] = useState<'rules' | 'ai' | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // AI drafts: the provider the data goes to (null = none configured) and the user's go-ahead.
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai' | 'azure' | null>(null);
  const [aiConsent, setAiConsent] = useState(false);
  const selectedTemplate = templates.find((tpl) => tpl.id === selectedTemplateId);

  // Load assessments & templates
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [assRes, tplRes, docRes, invRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/assessments`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/assessment-templates`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/documents`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/interviews`, { headers: await authHeaders() }),
      ]);

      const [assData, tplData, docData, invData] = await Promise.all([
        assRes.json(),
        tplRes.json(),
        docRes.json(),
        invRes.json(),
      ]);

      if (assData?.ok) setAssessments(assData.assessments ?? []);
      if (tplData?.ok) {
        setTemplates(tplData.templates ?? []);
        setAiProvider(tplData.aiProvider ?? null);
        if (tplData.templates?.length > 0 && !selectedTemplateId) {
          const match = tplData.templates.find((t: AssessmentTemplate) => t.domain === caseItem.domain) || tplData.templates[0];
          setSelectedTemplateId(match.id);
          setNewTitle(`${match.name} — ${caseItem.subject_name}`);
        }
      }
      if (docData?.ok) setEvidenceDocs(docData.documents ?? []);
      if (invData?.ok) setInterviewTranscripts(invData.interviews ?? []);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [orgId, caseItem.id, caseItem.domain, caseItem.subject_name, authHeaders, t, selectedTemplateId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openEditor = async (ass: Assessment) => {
    setActiveAssessment(ass);
    setAssessmentStatus(ass.status);
    setSectionsContent(ass.sections_content ?? {});
    const tpl = templates.find((t) => t.id === ass.template_id);
    if (tpl) {
      setActiveTemplate(tpl);
    } else {
      // Fetch template
      const res = await fetch(`${API}/organizations/${orgId}/assessment-templates/${ass.template_id}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data?.ok) setActiveTemplate(data.template);
    }
  };

  /** Creates the assessment, pre-filled by the rule-based draft or by the AI (which the template must allow). */
  const handleCreateAssessment = async (mode: 'rules' | 'ai') => {
    if (!selectedTemplateId || !newTitle.trim()) return;
    try {
      setCreating(mode);
      setCreateError(null);
      const synRes = await fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/assessments/${mode === 'ai' ? 'ai-draft' : 'synthesize'}`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: selectedTemplateId }),
      });
      const synData = await synRes.json().catch(() => null);
      if (!synRes.ok || !synData?.ok || !synData.draft?.sections_content) {
        setCreateError(draftError(synData?.message ?? synData?.error));
        return;
      }

      const res = await fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/assessments`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: selectedTemplateId,
          title: newTitle.trim(),
          sections_content: synData.draft.sections_content,
        }),
      });

      const data = await res.json().catch(() => null);
      if (data?.ok && data.assessment) {
        setOpenCreate(false);
        setAiConsent(false);
        await loadData();
        await onRefreshCase();
        await openEditor(data.assessment);
      } else {
        setCreateError(draftError(data?.message ?? data?.error));
      }
    } catch {
      setCreateError(t('common.cannotReachApi'));
    } finally {
      setCreating(null);
    }
  };

  const draftError = (code: unknown) =>
    caseErrorText(typeof code === 'string' ? code : '', t, 'cases.assessments.error.') ?? t('cases.interviews.operationFailed');

  const handleSaveAssessment = async () => {
    if (!activeAssessment) return;
    try {
      setSavingAssessment(true);
      const res = await fetch(
        `${API}/organizations/${orgId}/cases/${caseItem.id}/assessments/${activeAssessment.id}`,
        {
          method: 'PATCH',
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: assessmentStatus,
            sections_content: sectionsContent,
          }),
        },
      );
      const data = await res.json();
      if (data?.ok && data.assessment) {
        setActiveAssessment(data.assessment);
        await loadData();
      }
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setSavingAssessment(false);
    }
  };

  const handleDownloadPdf = async (assessmentId: string) => {
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/cases/${caseItem.id}/assessments/${assessmentId}/pdf`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error('pdf-generation-failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Beurteilung_${caseItem.reference_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  };

  return (
    <Box>
      {!activeAssessment ? (
        // ---------------------------------------------------------------------
        // Assessments List
        // ---------------------------------------------------------------------
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('cases.assessments.title')}
            </Typography>
            {canEdit && (
              <Button
                variant="contained"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => setOpenCreate(true)}
              >
                {t('cases.assessments.newAssessment')}
              </Button>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {loading ? (
            <CircularProgress />
          ) : assessments.length === 0 ? (
            <EmptyState
              title={t('cases.assessments.noAssessmentsTitle')}
              description={t('cases.assessments.noAssessmentsDescription')}
              action={
                canEdit ? (
                  <Button variant="contained" onClick={() => setOpenCreate(true)}>
                    {t('cases.assessments.newAssessment')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Stack spacing={2}>
              {assessments.map((a) => (
                <Card key={a.id} variant="outlined">
                  <CardContent sx={{ pb: '16px !important' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {a.title}
                          </Typography>
                          <Chip
                            size="small"
                            label={t(`cases.assessmentStatus.${a.status}`)}
                            color={a.status === 'signed' ? 'success' : a.status === 'final' ? 'primary' : 'default'}
                            variant="outlined"
                          />
                          <Chip size="small" label={`v${a.version}`} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Vorlage: {a.template_name ?? 'Standard'} • Verfasser: {a.author_name ?? t('cases.unassigned')} •{' '}
                          Aktualisiert: {a.updated_at.slice(0, 10)}
                        </Typography>
                      </Box>

                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<EditIcon fontSize="small" />}
                          onClick={() => openEditor(a)}
                        >
                          {t('cases.assessments.openEditor')}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadIcon fontSize="small" />}
                          onClick={() => handleDownloadPdf(a.id)}
                        >
                          {t('cases.assessments.exportPdf')}
                        </Button>
                      </Stack>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}

          {/* New Assessment Modal */}
          <Dialog open={openCreate} onClose={() => { if (creating === null) setOpenCreate(false); }} maxWidth="sm" fullWidth>
            <DialogTitle>{t('cases.assessments.createModalTitle')}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  select
                  label={t('cases.assessments.chooseTemplate')}
                  required
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    setAiConsent(false);
                    const tpl = templates.find((t) => t.id === e.target.value);
                    if (tpl) setNewTitle(`${tpl.name} — ${caseItem.subject_name}`);
                  }}
                >
                  {templates.map((tpl) => (
                    <MenuItem key={tpl.id} value={tpl.id}>
                      {tpl.name} ({t(`cases.domain.${tpl.domain}`)})
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  label={t('cases.assessments.assessmentTitle')}
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />

                <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {t('cases.assessments.autoSynthesizeTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('cases.assessments.autoSynthesizeDesc', {
                      docs: evidenceDocs.length,
                      interviews: interviewTranscripts.length,
                    })}
                  </Typography>
                </Box>

                {selectedTemplate?.ai_allowed && (aiProvider ? (
                  <Alert severity="warning">
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {t('cases.assessments.aiNotice', { provider: t(`cases.assessments.aiProvider.${aiProvider}`) })}
                    </Typography>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={aiConsent} onChange={(e) => setAiConsent(e.target.checked)} />}
                      label={t('cases.assessments.aiConsent')}
                    />
                  </Alert>
                ) : (
                  <Alert severity="info">{t('cases.assessments.error.ai-not-configured')}</Alert>
                ))}
                {creating === 'ai' && (
                  <Alert severity="info" icon={<CircularProgress size={20} />}>{t('cases.assessments.aiWorking')}</Alert>
                )}
                {createError && <Alert severity="error">{createError}</Alert>}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenCreate(false)} disabled={creating !== null}>{t('common.cancel')}</Button>
              <Button
                variant="outlined"
                onClick={() => void handleCreateAssessment('rules')}
                disabled={creating !== null || !selectedTemplateId || !newTitle.trim()}
              >
                {creating === 'rules' ? <CircularProgress size={20} /> : t('cases.assessments.startDraft')}
              </Button>
              {selectedTemplate?.ai_allowed && (
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => void handleCreateAssessment('ai')}
                  disabled={creating !== null || !aiProvider || !aiConsent || !selectedTemplateId || !newTitle.trim()}
                >
                  {creating === 'ai' ? <CircularProgress size={20} /> : t('cases.assessments.startAiDraft')}
                </Button>
              )}
            </DialogActions>
          </Dialog>
        </Box>
      ) : (
        // ---------------------------------------------------------------------
        // Side-by-Side Assessment Workspace
        // ---------------------------------------------------------------------
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" onClick={() => setActiveAssessment(null)}>
              ← {t('cases.assessments.backToAssessments')}
            </Button>

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                select
                size="small"
                value={assessmentStatus}
                onChange={(e) => setAssessmentStatus(e.target.value)}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="draft">{t('cases.assessmentStatus.draft')}</MenuItem>
                <MenuItem value="in_review">{t('cases.assessmentStatus.in_review')}</MenuItem>
                <MenuItem value="final">{t('cases.assessmentStatus.final')}</MenuItem>
                <MenuItem value="signed">{t('cases.assessmentStatus.signed')}</MenuItem>
              </TextField>

              <Button
                variant="outlined"
                size="small"
                onClick={() => setShowEvidenceSidebar(!showEvidenceSidebar)}
              >
                {showEvidenceSidebar ? t('cases.assessments.hideEvidence') : t('cases.assessments.showEvidence')}
              </Button>

              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon fontSize="small" />}
                onClick={() => handleDownloadPdf(activeAssessment.id)}
              >
                {t('cases.assessments.exportPdf')}
              </Button>

              <Button
                variant="contained"
                size="small"
                startIcon={<SaveIcon fontSize="small" />}
                onClick={handleSaveAssessment}
                disabled={savingAssessment}
              >
                {savingAssessment ? <CircularProgress size={20} /> : t('common.save')}
              </Button>
            </Stack>
          </Box>

          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            {activeAssessment.title}
          </Typography>

          <Grid container spacing={2}>
            {/* Left: Template Section Editors */}
            <Grid item xs={12} md={showEvidenceSidebar ? 7 : 12}>
              <Stack spacing={2.5}>
                {((activeTemplate?.sections as AssessmentTemplateSection[]) ?? []).map((sec, idx) => (
                  <Card key={sec.key} variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'primary.main', mb: 0.5 }}>
                        {sec.title}
                      </Typography>
                      {sec.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                          {sec.description}
                        </Typography>
                      )}
                      {sec.promptGuidance && (
                        <Box sx={{ mb: 1.5, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                          <Typography variant="caption" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                            💡 {sec.promptGuidance}
                          </Typography>
                        </Box>
                      )}
                      <TextField
                        multiline
                        minRows={4}
                        maxRows={16}
                        fullWidth
                        value={sectionsContent[sec.key] ?? ''}
                        onChange={(e) =>
                          setSectionsContent({
                            ...sectionsContent,
                            [sec.key]: e.target.value,
                          })
                        }
                        placeholder={t('cases.assessments.enterSectionContent')}
                      />
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </Grid>

            {/* Right: Side-by-Side Evidence Inspector */}
            {showEvidenceSidebar && (
              <Grid item xs={12} md={5}>
                <Card variant="outlined" sx={{ position: 'sticky', top: 20, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                      🔍 {t('cases.assessments.evidenceInspector')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                      {t('cases.assessments.evidenceInspectorHelp')}
                    </Typography>

                    {/* Evidence Documents */}
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
                      {t('cases.tab.documents')} ({evidenceDocs.length})
                    </Typography>
                    {evidenceDocs.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        Keine Akten vorhanden.
                      </Typography>
                    ) : (
                      <Stack spacing={1} sx={{ mb: 2.5 }}>
                        {evidenceDocs.map((d) => (
                          <Box key={d.id} sx={{ p: 1, bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {d.title}
                              </Typography>
                              <Chip size="small" label={d.category} sx={{ height: 18, fontSize: '0.65rem' }} />
                            </Box>
                            {d.extracted_text && (
                              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', maxHeight: 80, overflowY: 'auto', whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                                "{d.extracted_text}"
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Stack>
                    )}

                    {/* Interview Transcripts */}
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
                      {t('cases.tab.interviews')} ({interviewTranscripts.length})
                    </Typography>
                    {interviewTranscripts.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        Keine Einvernahmen erfasst.
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        {interviewTranscripts.map((i) => (
                          <Box key={i.id} sx={{ p: 1, bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {i.interviewee_name} ({i.interviewee_role})
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {i.interview_date}
                              </Typography>
                            </Box>
                            {(i.transcript_stale || i.summary_stale) && (
                              <Typography variant="caption" display="block" color="warning.main">{t('cases.interviews.outputsStale')}</Typography>
                            )}
                            {i.summary && (
                              <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                                <strong>Fazit:</strong> {i.summary}
                              </Typography>
                            )}
                            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', maxHeight: 90, overflowY: 'auto', whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                              "{i.transcript_text}"
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            )}
          </Grid>
        </Box>
      )}
    </Box>
  );
}

// =============================================================================
// Tab 4: Client-Changeable Template Designer
// =============================================================================

function CaseTemplatesTab({
  orgId,
  authHeaders,
  canEdit,
}: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<AssessmentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Template editor modal
  const [selectedTemplate, setSelectedTemplate] = useState<AssessmentTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [templateAi, setTemplateAi] = useState(false);
  const [sections, setSections] = useState<AssessmentTemplateSection[]>([]);
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/organizations/${orgId}/assessment-templates`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data?.ok) setTemplates(data.templates ?? []);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [orgId, authHeaders, t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const openCustomizer = (tpl: AssessmentTemplate) => {
    setSelectedTemplate(tpl);
    setTemplateName(tpl.organization_id ? tpl.name : `${tpl.name} (${t('cases.templates.orgCustom')})`);
    setTemplateDesc(tpl.description ?? '');
    setTemplateAi(tpl.organization_id ? tpl.ai_allowed === true : false);
    setSections([...(tpl.sections as AssessmentTemplateSection[])]);
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplate) return;
    try {
      setSaving(true);
      setError(null);
      const res = selectedTemplate.organization_id
        ? // Update existing org template
          await fetch(`${API}/organizations/${orgId}/assessment-templates/${selectedTemplate.id}`, {
            method: 'PATCH',
            headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: templateName,
              description: templateDesc,
              sections,
              ai_allowed: templateAi,
            }),
          })
        : // Create org copy from global default template
          await fetch(`${API}/organizations/${orgId}/assessment-templates`, {
            method: 'POST',
            headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: templateName,
              domain: selectedTemplate.domain,
              description: templateDesc,
              sections,
              ai_allowed: templateAi,
            }),
          });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.message ?? data?.error ?? t('cases.interviews.operationFailed'));
        return;
      }
      setSelectedTemplate(null);
      await loadTemplates();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddSection = () => {
    const newSec: AssessmentTemplateSection = {
      key: `section_${Date.now()}`,
      title: `Neuer Abschnitt ${sections.length + 1}`,
      description: '',
      promptGuidance: '',
      isRequired: true,
      order: sections.length + 1,
    };
    setSections([...sections, newSec]);
  };

  const handleRemoveSection = (index: number) => {
    const updated = [...sections];
    updated.splice(index, 1);
    setSections(updated);
  };

  const handleSectionChange = (index: number, field: keyof AssessmentTemplateSection, value: any) => {
    const updated = [...sections];
    updated[index] = { ...updated[index], [field]: value };
    setSections(updated);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('cases.templates.title')}
        </Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('cases.templates.description')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <CircularProgress />
      ) : (
        <Grid container spacing={2}>
          {templates.map((tpl) => (
            <Grid item xs={12} md={4} key={tpl.id}>
              <Card variant="outlined">
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Chip size="small" label={t(`cases.domain.${tpl.domain}`)} />
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {tpl.ai_allowed && (
                        <Chip size="small" label={t('cases.templates.aiAllowedChip')} color="warning" variant="outlined" />
                      )}
                      {tpl.organization_id ? (
                        <Chip size="small" label={t('cases.templates.orgSpecific')} color="primary" variant="outlined" />
                      ) : (
                        <Chip size="small" label={t('cases.templates.swissStandard')} variant="outlined" />
                      )}
                    </Box>
                  </Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {tpl.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {tpl.description ?? t('cases.templates.noDescription')}
                  </Typography>

                  <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                    {t('cases.templates.sectionsCount', { count: (tpl.sections as any[])?.length ?? 0 })}
                  </Typography>

                  {canEdit && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<EditIcon fontSize="small" />}
                      onClick={() => openCustomizer(tpl)}
                      fullWidth
                    >
                      {tpl.organization_id ? t('common.edit') : t('cases.templates.customizeForOrg')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Template Designer Dialog */}
      <Dialog open={!!selectedTemplate} onClose={() => setSelectedTemplate(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {selectedTemplate?.organization_id ? t('cases.templates.editTemplate') : t('cases.templates.customizeTemplate')}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('cases.templates.templateName')}
              required
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <TextField
              label={t('cases.templates.templateDescription')}
              value={templateDesc}
              onChange={(e) => setTemplateDesc(e.target.value)}
            />
            <Box>
              <FormControlLabel
                control={<Switch checked={templateAi} onChange={(e) => setTemplateAi(e.target.checked)} />}
                label={t('cases.templates.aiAllowed')}
              />
              <Typography variant="caption" color="text.secondary" component="div">
                {t('cases.templates.aiAllowedHelp')}
              </Typography>
            </Box>

            <Divider sx={{ my: 1 }} />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {t('cases.templates.definedSections')}
              </Typography>
              <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={handleAddSection}>
                {t('cases.templates.addSection')}
              </Button>
            </Box>

            <Stack spacing={2}>
              {sections.map((sec, idx) => (
                <Box
                  key={sec.key || idx}
                  sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      #{idx + 1}
                    </Typography>
                    <IconButton size="small" color="error" onClick={() => handleRemoveSection(idx)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>

                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        size="small"
                        label={t('cases.templates.sectionTitle')}
                        fullWidth
                        value={sec.title}
                        onChange={(e) => handleSectionChange(idx, 'title', e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        size="small"
                        label={t('cases.templates.sectionKey')}
                        fullWidth
                        value={sec.key}
                        onChange={(e) => handleSectionChange(idx, 'key', e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        size="small"
                        label={t('cases.templates.sectionGuidance')}
                        fullWidth
                        value={sec.promptGuidance ?? ''}
                        onChange={(e) => handleSectionChange(idx, 'promptGuidance', e.target.value)}
                        placeholder="e.g. Fasse die Aktenlage chronologisch zusammen..."
                      />
                    </Grid>
                  </Grid>
                </Box>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedTemplate(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleSaveTemplate} disabled={saving || !templateName.trim()}>
            {saving ? <CircularProgress size={20} /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
