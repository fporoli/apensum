import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatSignedMinutes, swissLocale } from './localeFormat';
import { ConfirmDialog, PageHeader } from './components';
import {
  DownloadIcon,
  UploadIcon,
  PaymentsIcon,
  PeopleIcon,
  FolderCopyIcon,
  CheckIcon,
} from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PayrollPreviewRow {
  userId: string;
  name?: string;
  displayName?: string;
  email: string;
  personnelNumber?: string;
  department?: string;
  departmentName?: string;
  targetMinutes?: number;
  actualMinutes?: number;
  deltaMinutes?: number;
  overtimeBalanceMinutes?: number;
  adjustmentMinutes?: number;
  legalOvertimeMinutes?: number;
  targetHours?: number;
  actualHours?: number;
  deltaHours?: number;
  overtimeBalanceHours?: number;
  overtimePayoutHours?: number;
  legalOvertimeHours?: number;
  vacationDaysTaken?: number;
  expenseTotal?: number;
  approvedExpensesCents?: number;
}

function normalizeDateStr(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dotMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (dotMatch) {
    const day = dotMatch[1].padStart(2, '0');
    const month = dotMatch[2].padStart(2, '0');
    const year = dotMatch[3];
    return `${year}-${month}-${day}`;
  }
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    return `${year}-${month}-${day}`;
  }
  return s;
}

function toMinutes(minutesVal?: number, hoursVal?: number): number {
  if (typeof minutesVal === 'number' && Number.isFinite(minutesVal)) return minutesVal;
  if (typeof hoursVal === 'number' && Number.isFinite(hoursVal)) return Math.round(hoursVal * 60);
  return 0;
}

interface RawEmployeeRow {
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  personnelNumber?: string;
  socialSecurityNumber?: string;
  department?: string;
  jobFunction?: string;
  workloadPercent?: string | number;
  startDate?: string;
  managerEmail?: string;
}

interface ImportPreviewResult {
  status: 'new' | 'update' | 'error';
  message?: string;
  errors?: string[];
  row: RawEmployeeRow;
}

interface ImportSummary {
  total: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
}

export interface ImportExportProps {
  orgId: string;
  isAdmin: boolean;
  isHr: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function ImportExport({ orgId, authHeaders }: ImportExportProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();

  const [activeTab, setActiveTab] = useState(0);

  // --- Tab 0: Payroll Export State ---
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [payrollRows, setPayrollRows] = useState<PayrollPreviewRow[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);

  // Fetch monthly payroll preview
  const fetchPayroll = useCallback(async (month: string) => {
    setPayrollLoading(true);
    setPayrollError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/export/payroll?month=${month}`, { headers });
      const data = await res.json();
      if (data.ok) {
        setPayrollRows(data.rows ?? []);
      } else {
        setPayrollError(data.error ?? 'Failed to load payroll data');
      }
    } catch {
      setPayrollError('Network error loading payroll');
    } finally {
      setPayrollLoading(false);
    }
  }, [orgId, authHeaders]);

  useEffect(() => {
    if (activeTab === 0) {
      void fetchPayroll(selectedMonth);
    }
  }, [activeTab, selectedMonth, fetchPayroll]);

  // Download helper for payroll endpoints
  const handleDownloadPayroll = async (endpoint: string, formatId: string, filename: string) => {
    setDownloadingFormat(formatId);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/export/payroll/${endpoint}?month=${selectedMonth}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      setPayrollError(e?.message ?? 'Download failed');
    } finally {
      setDownloadingFormat(null);
    }
  };

  // --- Tab 1: Bulk Employee Import State ---
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedRows, setUploadedRows] = useState<RawEmployeeRow[]>([]);
  const [previewSummary, setPreviewSummary] = useState<ImportSummary | null>(null);
  const [previewResults, setPreviewResults] = useState<ImportPreviewResult[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Client-side CSV template download
  const handleDownloadTemplate = () => {
    const headers = [
      'email',
      'displayName',
      'firstName',
      'lastName',
      'personnelNumber',
      'socialSecurityNumber',
      'department',
      'jobFunction',
      'workloadPercent',
      'startDate',
      'managerEmail',
    ];
    const sampleRows = [
      'anna.muster@example.ch,Anna Muster,Anna,Muster,1001,756.1234.5678.90,Finance,Senior Accountant,100,2026-01-01,',
      'beat.meier@example.ch,Beat Meier,Beat,Meier,1002,756.9876.5432.10,Engineering,Software Engineer,80,2026-03-01,anna.muster@example.ch',
    ];
    const csvContent = [headers.join(','), ...sampleRows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'employee_import_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  // Robust CSV parser supporting commas/semicolons, quotes and multilingual header aliases
  const parseCsvText = (text: string): RawEmployeeRow[] => {
    const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
    const lines: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '"') {
        if (inQuotes && clean[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && clean[i + 1] === '\n') {
          i++;
        }
        lines.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.length > 0) lines.push(current);

    const validLines = lines.map((l) => l.trim()).filter(Boolean);
    if (validLines.length === 0) return [];

    const firstLine = validLines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';

    const splitLine = (line: string): string[] => {
      const fields: string[] = [];
      let field = '';
      let quotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (quotes && line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quotes = !quotes;
          }
        } else if (c === delimiter && !quotes) {
          fields.push(field.trim());
          field = '';
        } else {
          field += c;
        }
      }
      fields.push(field.trim());
      return fields;
    };

    const headerRow = splitLine(validLines[0]);
    const headers = headerRow.map((h) => {
      const norm = h.toLowerCase().replace(/[\s_-]+/g, '');
      if (norm === 'email' || norm === 'mail' || norm === 'emailaddress') return 'email';
      if (norm === 'displayname' || norm === 'name' || norm === 'fullname') return 'displayName';
      if (norm === 'firstname' || norm === 'vorname' || norm === 'prenom') return 'firstName';
      if (norm === 'lastname' || norm === 'nachname' || norm === 'nom') return 'lastName';
      if (norm === 'personnelnumber' || norm === 'personalnummer' || norm === 'persnr' || norm === 'employeeid') return 'personnelNumber';
      if (norm === 'socialsecuritynumber' || norm === 'ahv' || norm === 'ahvnummer' || norm === 'ssn') return 'socialSecurityNumber';
      if (norm === 'department' || norm === 'abteilung' || norm === 'departement') return 'department';
      if (norm === 'function' || norm === 'jobfunction' || norm === 'rolle' || norm === 'role') return 'jobFunction';
      if (norm === 'workload' || norm === 'workloadpercent' || norm === 'pensum' || norm === 'taux') return 'workloadPercent';
      if (norm === 'startdate' || norm === 'eintritt' || norm === 'eintrittsdatum' || norm === 'entrydate') return 'startDate';
      if (norm === 'manager' || norm === 'manageremail' || norm === 'vorgesetzter' || norm === 'responsable') return 'managerEmail';
      return norm;
    });

    const parsedRows: RawEmployeeRow[] = [];
    for (let i = 1; i < validLines.length; i++) {
      const fields = splitLine(validLines[i]);
      if (fields.every((f) => f === '')) continue;
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = fields[idx] ?? '';
      });

      // Auto-derive displayName if empty from firstName and lastName
      if (!row.displayName && (row.firstName || row.lastName)) {
        row.displayName = [row.firstName, row.lastName].filter(Boolean).join(' ');
      }

      // Auto-normalize start date (e.g. 01.01.2026 -> 2026-01-01)
      if (row.startDate) {
        row.startDate = normalizeDateStr(row.startDate) || row.startDate;
      }

      // Strip % from workload
      if (row.workloadPercent) {
        row.workloadPercent = String(row.workloadPercent).replace('%', '').trim();
      }

      parsedRows.push(row as RawEmployeeRow);
    }
    return parsedRows;
  };

  const handleProcessFile = async (file: File) => {
    setImportError(null);
    setImportSuccess(null);
    setImportLoading(true);
    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      if (parsed.length === 0) {
        setImportError('The uploaded file contains no data rows.');
        setImportLoading(false);
        return;
      }
      setUploadedRows(parsed);

      // Call API preview endpoint
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/import/employees/preview`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (data.ok) {
        setPreviewSummary(data.summary);
        setPreviewResults(data.results ?? []);
      } else {
        setImportError(data.error ?? 'Validation failed');
      }
    } catch (e: any) {
      setImportError(e?.message ?? 'Failed to parse file');
    } finally {
      setImportLoading(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      void handleProcessFile(files[0]);
    }
  };

  const handleCommitImport = async () => {
    if (uploadedRows.length === 0) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/import/employees/commit`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: uploadedRows }),
      });
      const data = await res.json();
      if (data.ok) {
        setImportSuccess(
          t('importExport.employees.commitSuccess', {
            created: data.created ?? 0,
            updated: data.updated ?? 0,
          }),
        );
        // Clear staged preview
        setUploadedRows([]);
        setPreviewSummary(null);
        setPreviewResults([]);
      } else {
        setImportError(data.error ?? 'Import commit failed');
      }
    } catch (e: any) {
      setImportError(e?.message ?? 'Network error committing import');
    } finally {
      setImportLoading(false);
    }
  };

  // --- Tab 2: Organization Backup & Restore State & Handlers ---
  const [backupExportLoading, setBackupExportLoading] = useState(false);
  const [backupExportDownloaded, setBackupExportDownloaded] = useState<string | null>(null);
  const [backupExportError, setBackupExportError] = useState<string | null>(null);

  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const [backupDragOver, setBackupDragOver] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPreviewLoading, setBackupPreviewLoading] = useState(false);
  const [backupPreviewData, setBackupPreviewData] = useState<any | null>(null);
  const [backupPreviewError, setBackupPreviewError] = useState<string | null>(null);

  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreSuccessDetails, setRestoreSuccessDetails] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const handleExportBackup = async () => {
    setBackupExportLoading(true);
    setBackupExportDownloaded(null);
    setBackupExportError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/export/backup`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const disposition = res.headers.get('content-disposition');
      let filename = `backup_organization_${new Date().toISOString().slice(0, 10)}.zip`;
      if (disposition) {
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setBackupExportDownloaded(filename);
    } catch {
      setBackupExportError('Failed to generate organization backup archive');
    } finally {
      setBackupExportLoading(false);
    }
  };

  const handleSelectBackupFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setBackupPreviewError('Only .zip files are supported for organization restore');
      return;
    }
    setBackupFile(file);
    setBackupPreviewLoading(true);
    setBackupPreviewData(null);
    setBackupPreviewError(null);
    setRestoreSuccessDetails(null);
    setRestoreError(null);

    try {
      const headers = await authHeaders();
      const formHeaders: Record<string, string> = {};
      if (headers.authorization) formHeaders.authorization = headers.authorization;
      if (headers.Authorization) formHeaders.Authorization = headers.Authorization;

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API}/organizations/${orgId}/import/backup/preview`, {
        method: 'POST',
        headers: formHeaders,
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setBackupPreviewData(data);
      } else {
        setBackupPreviewError(data.error || 'Failed to inspect backup archive');
      }
    } catch {
      setBackupPreviewError('Network error while inspecting backup archive');
    } finally {
      setBackupPreviewLoading(false);
    }
  };

  const handleCommitRestore = async () => {
    if (!backupFile) return;
    setConfirmRestoreOpen(false);
    setRestoreLoading(true);
    setRestoreSuccessDetails(null);
    setRestoreError(null);

    try {
      const headers = await authHeaders();
      const formHeaders: Record<string, string> = {};
      if (headers.authorization) formHeaders.authorization = headers.authorization;
      if (headers.Authorization) formHeaders.Authorization = headers.Authorization;

      const formData = new FormData();
      formData.append('file', backupFile);

      const res = await fetch(`${API}/organizations/${orgId}/import/backup/commit`, {
        method: 'POST',
        headers: formHeaders,
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        const r = data.restored || {};
        const summaryParts: string[] = [];
        if (r.users) summaryParts.push(`${r.users} users`);
        if (r.workTimes) summaryParts.push(`${r.workTimes} work times`);
        if (r.absences) summaryParts.push(`${r.absences} absences`);
        if (r.expenses) summaryParts.push(`${r.expenses} expenses`);
        if (r.projects) summaryParts.push(`${r.projects} projects`);
        if (r.documents) summaryParts.push(`${r.documents} documents`);
        const summaryText = summaryParts.length > 0 ? summaryParts.join(', ') : 'All collections merged';
        setRestoreSuccessDetails(summaryText);
        setBackupFile(null);
        setBackupPreviewData(null);
      } else {
        setRestoreError(data.error || 'Failed to restore organization backup');
      }
    } catch {
      setRestoreError('Network error during backup restore');
    } finally {
      setRestoreLoading(false);
    }
  };

  const handleCancelRestore = () => {
    setBackupFile(null);
    setBackupPreviewData(null);
    setBackupPreviewError(null);
    setRestoreError(null);
    if (backupInputRef.current) {
      backupInputRef.current.value = '';
    }
  };

  return (
    <Box sx={{ width: '100%', py: 2 }}>
      <PageHeader
        title={t('importExport.title')}
        subtitle={t('importExport.subtitle')}
      />

      <Paper
        elevation={0}
        sx={{
          mt: 2.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(_, next) => setActiveTab(next)}
          textColor="primary"
          indicatorColor="primary"
          sx={{
            px: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: (th) => alpha(th.palette.background.paper, 0.6),
            '& .MuiTab-root': {
              minHeight: 48,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.875rem',
            },
          }}
        >
          <Tab
            icon={<PaymentsIcon fontSize="small" />}
            iconPosition="start"
            label={t('importExport.tabPayroll')}
          />
          <Tab
            icon={<PeopleIcon fontSize="small" />}
            iconPosition="start"
            label={t('importExport.tabEmployees')}
          />
          <Tab
            icon={<FolderCopyIcon fontSize="small" />}
            iconPosition="start"
            label={t('importExport.tabBackup')}
          />
        </Tabs>

        {/* ============================================================== */}
        {/* TAB 0: PAYROLL EXPORT (Abacus, Bexio, Excel, Generic CSV)       */}
        {/* ============================================================== */}
        {activeTab === 0 && (
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: { xs: 'stretch', sm: 'center' },
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
                mb: 3,
              }}
            >
              <TextField
                type="month"
                size="small"
                label={t('importExport.payroll.period')}
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 200 }}
              />

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={<DownloadIcon fontSize="small" />}
                  disabled={downloadingFormat !== null}
                  onClick={() =>
                    handleDownloadPayroll('abacus', 'abacus', `payroll_abacus_${selectedMonth}.csv`)
                  }
                  sx={{ fontWeight: 600 }}
                >
                  {t('importExport.payroll.downloadAbacus')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon fontSize="small" />}
                  disabled={downloadingFormat !== null}
                  onClick={() =>
                    handleDownloadPayroll('bexio', 'bexio', `payroll_bexio_${selectedMonth}.csv`)
                  }
                >
                  {t('importExport.payroll.downloadBexio')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon fontSize="small" />}
                  disabled={downloadingFormat !== null}
                  onClick={() =>
                    handleDownloadPayroll('xlsx', 'xlsx', `payroll_${selectedMonth}.xlsx`)
                  }
                >
                  {t('importExport.payroll.downloadExcel')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon fontSize="small" />}
                  disabled={downloadingFormat !== null}
                  onClick={() =>
                    handleDownloadPayroll('csv', 'csv', `payroll_summary_${selectedMonth}.csv`)
                  }
                >
                  {t('importExport.payroll.downloadGenericCsv')}
                </Button>
              </Box>
            </Box>

            <Alert severity="info" sx={{ mb: 2.5, borderRadius: 1.5, fontSize: '0.85rem' }}>
              {t('importExport.payroll.abacusHint')}
            </Alert>

            {payrollError && (
              <Alert severity="error" sx={{ mb: 2.5, borderRadius: 1.5 }}>
                {payrollError}
              </Alert>
            )}

            {payrollLoading && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{ borderRadius: 1.5, overflow: 'hidden' }}
            >
              <Table size="small" sx={{ minWidth: 800 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>{t('importExport.payroll.colEmployee')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('importExport.payroll.colPersonnelNr')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colTargetHours')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colActualHours')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colDeltaHours')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colOvertimeBalance')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colAdjustmentPayout')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colVacationDays')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{t('importExport.payroll.colExpenses')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payrollRows.length === 0 && !payrollLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        {t('importExport.payroll.noData')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    payrollRows.map((row) => {
                      const targetMin = toMinutes(row.targetMinutes, row.targetHours);
                      const actualMin = toMinutes(row.actualMinutes, row.actualHours);
                      const deltaMin = toMinutes(row.deltaMinutes, row.deltaHours);
                      const overtimeBalMin = toMinutes(row.overtimeBalanceMinutes, row.overtimeBalanceHours);
                      const payoutMin = toMinutes(row.adjustmentMinutes, row.overtimePayoutHours ? -row.overtimePayoutHours : undefined);

                      const deltaColor =
                        deltaMin > 0
                          ? theme.palette.success.main
                          : deltaMin < 0
                            ? theme.palette.error.main
                            : 'inherit';

                      const expAmount =
                        typeof row.expenseTotal === 'number' && Number.isFinite(row.expenseTotal)
                          ? row.expenseTotal
                          : typeof row.approvedExpensesCents === 'number' && Number.isFinite(row.approvedExpensesCents)
                            ? row.approvedExpensesCents / 100
                            : 0;

                      const expensesFormatted = expAmount.toLocaleString(
                        swissLocale(locale),
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                      );

                      const vacationDays =
                        typeof row.vacationDaysTaken === 'number' && Number.isFinite(row.vacationDaysTaken)
                          ? row.vacationDaysTaken
                          : 0;

                      const empName = row.displayName || row.name || row.email;
                      const empDept = row.department || row.departmentName || '';

                      return (
                        <TableRow key={row.userId} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {empName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.email}
                              {empDept ? ` • ${empDept}` : ''}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {row.personnelNumber || '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatDurationMinutes(targetMin)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatDurationMinutes(actualMin)}
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontVariantNumeric: 'tabular-nums', color: deltaColor, fontWeight: 600 }}
                          >
                            {formatSignedMinutes(deltaMin)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatSignedMinutes(overtimeBalMin)}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {payoutMin !== 0 ? formatSignedMinutes(payoutMin) : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {vacationDays.toLocaleString(swissLocale(locale), {
                              maximumFractionDigits: 1,
                            })}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            CHF {expensesFormatted}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* ============================================================== */}
        {/* TAB 1: BULK EMPLOYEE IMPORT                                    */}
        {/* ============================================================== */}
        {activeTab === 1 && (
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: { xs: 'stretch', sm: 'flex-start' },
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
                mb: 3,
              }}
            >
              <Box sx={{ maxWidth: 650 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {t('importExport.employees.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('importExport.employees.description')}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                size="small"
                startIcon={<DownloadIcon fontSize="small" />}
                onClick={handleDownloadTemplate}
              >
                {t('importExport.employees.downloadTemplate')}
              </Button>
            </Box>

            {/* Dropzone */}
            <Box
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              sx={{
                border: '2px dashed',
                borderColor: dragOver ? 'primary.main' : 'divider',
                bgcolor: dragOver ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
                borderRadius: 2,
                p: { xs: 3, sm: 4 },
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: alpha(theme.palette.primary.main, 0.03),
                },
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files[0]) {
                    void handleProcessFile(files[0]);
                  }
                }}
              />
              <UploadIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {t('importExport.employees.chooseFile')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('importExport.employees.dragDrop')}
              </Typography>
            </Box>

            {importLoading && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}

            {importError && (
              <Alert severity="error" sx={{ mt: 2.5, borderRadius: 1.5 }}>
                {importError}
              </Alert>
            )}

            {importSuccess && (
              <Alert severity="success" sx={{ mt: 2.5, borderRadius: 1.5 }}>
                {importSuccess}
              </Alert>
            )}

            {/* Preview Summary Bar */}
            {previewSummary && (
              <Box
                sx={{
                  mt: 3,
                  p: 2,
                  bgcolor: (th) => alpha(th.palette.background.default, 0.6),
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 2,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('importExport.employees.previewSummary', {
                      total: previewSummary.total,
                      newCount: previewSummary.newCount,
                      updateCount: previewSummary.updateCount,
                      errorCount: previewSummary.errorCount,
                    })}
                  </Typography>
                  <Chip
                    size="small"
                    label={`${t('importExport.employees.statusNew')}: ${previewSummary.newCount}`}
                    color="success"
                    variant="outlined"
                  />
                  <Chip
                    size="small"
                    label={`${t('importExport.employees.statusUpdate')}: ${previewSummary.updateCount}`}
                    color="warning"
                    variant="outlined"
                  />
                  {previewSummary.errorCount > 0 && (
                    <Chip
                      size="small"
                      label={`${t('importExport.employees.statusError')}: ${previewSummary.errorCount}`}
                      color="error"
                    />
                  )}
                </Box>

                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<CheckIcon fontSize="small" />}
                  disabled={
                    previewSummary.errorCount > 0 ||
                    previewSummary.total === 0 ||
                    importLoading
                  }
                  onClick={handleCommitImport}
                  sx={{ fontWeight: 600 }}
                >
                  {t('importExport.employees.commitBtn', {
                    count: previewSummary.newCount + previewSummary.updateCount,
                  })}
                </Button>
              </Box>
            )}

            {/* Preview Results Table */}
            {previewResults.length > 0 && (
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ mt: 2, borderRadius: 1.5, overflow: 'hidden' }}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colStatus')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colEmail')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colName')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colDepartment')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colWorkload')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colStartDate')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colManager')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('importExport.employees.colMessage')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewResults.map((item, idx) => {
                      const chipColor =
                        item.status === 'new'
                          ? 'success'
                          : item.status === 'update'
                            ? 'warning'
                            : 'error';
                      const label =
                        item.status === 'new'
                          ? t('importExport.employees.statusNew')
                          : item.status === 'update'
                            ? t('importExport.employees.statusUpdate')
                            : t('importExport.employees.statusError');
                      return (
                        <TableRow key={idx} hover sx={{ bgcolor: item.status === 'error' ? alpha(theme.palette.error.main, 0.04) : undefined }}>
                          <TableCell>
                            <Chip size="small" label={label} color={chipColor} />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{item.row.email || '—'}</TableCell>
                          <TableCell>
                            {item.row.displayName ||
                              [item.row.firstName, item.row.lastName].filter(Boolean).join(' ') ||
                              '—'}
                          </TableCell>
                          <TableCell>{item.row.department || '—'}</TableCell>
                          <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {item.row.workloadPercent ? `${item.row.workloadPercent}%` : '100%'}
                          </TableCell>
                          <TableCell>{item.row.startDate || '—'}</TableCell>
                          <TableCell>{item.row.managerEmail || '—'}</TableCell>
                          <TableCell>
                            {(() => {
                              const note = item.message || (item.errors && item.errors.length > 0 ? item.errors.join('; ') : '');
                              if (!note) return '—';
                              return (
                                <Tooltip title={note} arrow>
                                  <Typography
                                    variant="caption"
                                    color={item.status === 'error' ? 'error.main' : 'text.secondary'}
                                    sx={{ fontWeight: item.status === 'error' ? 600 : 400 }}
                                  >
                                    {note}
                                  </Typography>
                                </Tooltip>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}

        {/* ============================================================== */}
        {/* TAB 2: ORGANIZATION BACKUP & RESTORE                           */}
        {/* ============================================================== */}
        {activeTab === 2 && (
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {/* Header intro card */}
            <Card variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                  {t('importExport.backup.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6 }}>
                  {t('importExport.backup.description')}
                </Typography>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
                    gap: 2,
                    pt: 1,
                  }}
                >
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, borderRadius: 1.5, bgcolor: (th) => alpha(th.palette.background.default, 0.5) }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {t('importExport.backup.featureDb')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {t('importExport.backup.featureDbDesc')}
                    </Typography>
                  </Paper>

                  <Paper
                    variant="outlined"
                    sx={{ p: 2, borderRadius: 1.5, bgcolor: (th) => alpha(th.palette.background.default, 0.5) }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {t('importExport.backup.featureVault')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {t('importExport.backup.featureVaultDesc')}
                    </Typography>
                  </Paper>

                  <Paper
                    variant="outlined"
                    sx={{ p: 2, borderRadius: 1.5, bgcolor: (th) => alpha(th.palette.background.default, 0.5) }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                      {t('importExport.backup.featureManifest')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {t('importExport.backup.featureManifestDesc')}
                    </Typography>
                  </Paper>
                </Box>
              </CardContent>
            </Card>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 3,
                alignItems: 'start',
              }}
            >
              {/* Left Column: Export Organization Backup */}
              <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                    {t('importExport.backup.exportTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6 }}>
                    {t('importExport.backup.exportDesc')}
                  </Typography>

                  {backupExportError && (
                    <Alert severity="error" sx={{ mb: 2, borderRadius: 1.5 }}>
                      {backupExportError}
                    </Alert>
                  )}

                  {backupExportDownloaded && (
                    <Alert severity="success" sx={{ mb: 2, borderRadius: 1.5 }}>
                      {t('importExport.backup.exportSuccess', { filename: backupExportDownloaded })}
                    </Alert>
                  )}

                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    startIcon={backupExportLoading ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
                    disabled={backupExportLoading}
                    onClick={handleExportBackup}
                    sx={{ fontWeight: 600, px: 3, py: 1.2 }}
                  >
                    {backupExportLoading ? t('importExport.backup.exportGenerating') : t('importExport.backup.exportBtn')}
                  </Button>
                </CardContent>
              </Card>

              {/* Right Column: Restore Organization Backup */}
              <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                    {t('importExport.backup.restoreTitle')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5, lineHeight: 1.6 }}>
                    {t('importExport.backup.restoreDesc')}
                  </Typography>

                  {restoreSuccessDetails && (
                    <Alert severity="success" sx={{ mb: 2, borderRadius: 1.5 }}>
                      {t('importExport.backup.restoreSuccess', { details: restoreSuccessDetails })}
                    </Alert>
                  )}

                  {restoreError && (
                    <Alert severity="error" sx={{ mb: 2, borderRadius: 1.5 }}>
                      {t('importExport.backup.restoreError', { error: restoreError })}
                    </Alert>
                  )}

                  {backupPreviewError && (
                    <Alert severity="error" sx={{ mb: 2, borderRadius: 1.5 }}>
                      {backupPreviewError}
                    </Alert>
                  )}

                  {/* Hidden file input */}
                  <input
                    ref={backupInputRef}
                    type="file"
                    accept=".zip"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files[0]) {
                        void handleSelectBackupFile(files[0]);
                      }
                    }}
                  />

                  {/* Drag and Drop Zone (shown when no file staged) */}
                  {!backupFile && !backupPreviewLoading && (
                    <Box
                      onClick={() => backupInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setBackupDragOver(true);
                      }}
                      onDragLeave={() => setBackupDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setBackupDragOver(false);
                        const files = e.dataTransfer.files;
                        if (files && files[0]) {
                          void handleSelectBackupFile(files[0]);
                        }
                      }}
                      sx={{
                        border: '2px dashed',
                        borderColor: backupDragOver ? 'primary.main' : 'divider',
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        cursor: 'pointer',
                        bgcolor: backupDragOver ? alpha(theme.palette.primary.main, 0.05) : 'background.paper',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          borderColor: 'primary.main',
                          bgcolor: alpha(theme.palette.primary.main, 0.02),
                        },
                      }}
                    >
                      <UploadIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1, opacity: 0.8 }} />
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                        {t('importExport.backup.dropZone')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('importExport.backup.dropHint')}
                      </Typography>
                    </Box>
                  )}

                  {/* Loading progress */}
                  {(backupPreviewLoading || restoreLoading) && (
                    <Box sx={{ py: 3, textAlign: 'center' }}>
                      <LinearProgress sx={{ borderRadius: 1, mb: 1.5 }} />
                      <Typography variant="body2" color="text.secondary">
                        {backupPreviewLoading ? t('importExport.backup.inspecting') : t('importExport.backup.restoring')}
                      </Typography>
                    </Box>
                  )}

                  {/* Staged Backup Inspection Preview Card */}
                  {backupPreviewData && backupPreviewData.manifest && (
                    <Paper
                      variant="outlined"
                      sx={{ p: 2.5, borderRadius: 2, bgcolor: (th) => alpha(th.palette.background.default, 0.6) }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {t('importExport.backup.previewTitle')}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${Math.round((backupPreviewData.manifest.totalBytes || backupFile?.size || 0) / 1024)} KB`}
                          variant="outlined"
                        />
                      </Box>

                      <Divider sx={{ mb: 1.5 }} />

                      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
                        <Box>
                          <Typography variant="caption" color="text.secondary" component="div">
                            {t('importExport.backup.sourceOrg')}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {backupPreviewData.manifest.sourceOrganization?.name || '—'}
                          </Typography>
                        </Box>

                        <Box>
                          <Typography variant="caption" color="text.secondary" component="div">
                            {t('importExport.backup.createdDate')}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {backupPreviewData.manifest.createdAt
                              ? new Date(backupPreviewData.manifest.createdAt).toLocaleDateString(swissLocale(locale), {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </Typography>
                        </Box>
                      </Box>

                      {/* Entity counts badges */}
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600 }}>
                        {t('importExport.backup.recordsCount')}:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mb: 2 }}>
                        {backupPreviewData.manifest.counts && (
                          <>
                            <Chip size="small" label={`${t('importExport.backup.badgeUsers')}: ${backupPreviewData.manifest.counts.users ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeDepartments')}: ${backupPreviewData.manifest.counts.departments ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeWorkTimes')}: ${backupPreviewData.manifest.counts.workTimes ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeSchedules')}: ${backupPreviewData.manifest.counts.workSchedules ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeAbsences')}: ${backupPreviewData.manifest.counts.absences ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeExpenses')}: ${backupPreviewData.manifest.counts.expenses ?? 0}`} />
                            <Chip size="small" label={`${t('importExport.backup.badgeProjects')}: ${backupPreviewData.manifest.counts.projects ?? 0}`} />
                          </>
                        )}
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={`${t('importExport.backup.badgeDocuments')}: ${backupPreviewData.manifest.documentCount ?? 0}`}
                        />
                      </Box>

                      {/* Warnings if cross-org */}
                      {backupPreviewData.compatibility?.warnings && backupPreviewData.compatibility.warnings.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 2, borderRadius: 1.5 }}>
                          {backupPreviewData.compatibility.warnings.join(' ')}
                        </Alert>
                      )}

                      {/* Action buttons */}
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={handleCancelRestore}
                          disabled={restoreLoading}
                        >
                          {t('importExport.backup.cancelBtn')}
                        </Button>
                        <Button
                          variant="contained"
                          color="warning"
                          size="small"
                          startIcon={<UploadIcon />}
                          disabled={restoreLoading}
                          onClick={() => setConfirmRestoreOpen(true)}
                          sx={{ fontWeight: 600 }}
                        >
                          {t('importExport.backup.restoreBtn')}
                        </Button>
                      </Box>
                    </Paper>
                  )}
                </CardContent>
              </Card>
            </Box>

            {/* Confirmation Dialog */}
            <ConfirmDialog
              open={confirmRestoreOpen}
              title={t('importExport.backup.confirmTitle')}
              message={t('importExport.backup.confirmMessage', {
                org: backupPreviewData?.compatibility?.targetOrg?.name || orgId,
                source: backupPreviewData?.manifest?.sourceOrganization?.name || 'backup',
              })}
              confirmLabel={t('importExport.backup.confirmBtn')}
              cancelLabel={t('common.cancel') || 'Cancel'}
              confirmColor="warning"
              onConfirm={handleCommitRestore}
              onClose={() => setConfirmRestoreOpen(false)}
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
