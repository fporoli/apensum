import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField } from '@mui/material';
import type { CaseInterview } from '@worktime3/shared/cases';
import { useT } from './i18n';
import { CaseInterviewAudioInput } from './CaseInterviewAudioInput';

export async function interviewResponse(res: Response) {
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(res.status === 413 ? 'interview-audio-too-large' : data?.message ?? data?.error);
  return data;
}

export function interviewError(error: unknown, t: ReturnType<typeof useT>) {
  const message = error instanceof Error ? error.message : '';
  const key = `cases.interviews.${message}`;
  return t(key) === key ? t('cases.interviews.operationFailed') : t(key);
}

export function CaseInterviewEditor({ interview, url, authHeaders, canEdit, transcriptionEnabled, onChange, onClose }: {
  interview: CaseInterview;
  url: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  transcriptionEnabled: boolean;
  onChange: (interview: CaseInterview) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [transcript, setTranscript] = useState(interview.transcript_text);
  const [summary, setSummary] = useState(interview.summary ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [draft, setDraft] = useState<{ target: 'transcript' | 'summary'; text: string } | null>(null);
  const [reviewedTranscript, setReviewedTranscript] = useState(false);
  const transcriptDirty = reviewedTranscript || transcript !== interview.transcript_text;
  const [reviewedSummary, setReviewedSummary] = useState(false);
  const summaryDirty = reviewedSummary || summary !== (interview.summary ?? '');
  const locked = busy || recording;

  useEffect(() => {
    const objectUrl = audio ? URL.createObjectURL(audio) : '';
    setAudioUrl(objectUrl);
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [audio]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (error) { setError(interviewError(error, t)); }
    finally { setBusy(false); }
  };

  const request = async (suffix: string, method: string, body: FormData | object) => {
    const headers = await authHeaders();
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return interviewResponse(await fetch(`${url}${suffix}`, { method, headers, body: body instanceof FormData ? body : JSON.stringify(body) }));
  };

  const generate = (target: 'transcript' | 'summary') => run(async () => {
    const data = await request(target === 'transcript' ? '/transcribe' : '/summarize', 'POST', { revision: interview.revision });
    setDraft({ target, text: data.draft });
  });

  const save = () => run(async () => {
    const form = new FormData();
    form.append('data', JSON.stringify({ revision: interview.revision,
      ...(transcriptDirty ? { transcript_text: transcript } : {}),
      ...(summaryDirty ? { summary: summary.trim() ? summary : null } : {}),
    }));
    const { interview: next } = await request('', 'PATCH', form);
    onChange(next);
    setTranscript(next.transcript_text);
    setSummary(next.summary ?? '');
    setReviewedTranscript(false);
    setReviewedSummary(false);
  });

  const close = () => {
    if (!locked && (!(transcriptDirty || summaryDirty || file || draft) || confirm(t('cases.interviews.discard')))) onClose();
  };

  return (
    <Dialog open onClose={close} maxWidth="md" fullWidth>
      <DialogTitle>{interview.interviewee_name} ({interview.interview_date})</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {busy && <LinearProgress />}
          {interview.has_audio && (audioUrl ? <audio controls src={audioUrl} /> : <Button disabled={locked} onClick={() => void run(async () => {
            const res = await fetch(`${url}/audio`, { headers: await authHeaders(), cache: 'no-store' });
            if (!res.ok) await interviewResponse(res);
            setAudio(await res.blob());
          })}>{t('cases.interviews.playAudio')}</Button>)}
          {canEdit && <>
            <CaseInterviewAudioInput file={file} setFile={setFile} disabled={busy} setRecording={setRecording} />
            {file && <Button disabled={locked || transcriptDirty || summaryDirty || !!draft} onClick={() => void run(async () => {
              const form = new FormData();
              form.append('revision', interview.revision);
              form.append('file', file);
              const { interview: next } = await request('/audio', 'PUT', form);
              setAudio(null);
              setAudioUrl('');
              onChange(next);
              setFile(null);
            })}>{t(interview.has_audio ? 'cases.interviews.replaceAudio' : 'cases.interviews.attachAudio')}</Button>}
          </>}
          {interview.transcript_stale && <Alert severity="warning">{t('cases.interviews.transcriptStale')}</Alert>}
          <TextField label={t('cases.interviews.transcriptText')} value={transcript} multiline minRows={4} maxRows={14}
            onChange={(e) => setTranscript(e.target.value)} disabled={busy}
            InputProps={{ readOnly: !canEdit }} inputProps={{ maxLength: 100_000 }} />
          {canEdit && interview.has_audio && <Stack direction="row" spacing={1}>
            {transcriptionEnabled && <Button disabled={locked || !!draft} onClick={() => void generate('transcript')}>{t('cases.interviews.generateTranscript')}</Button>}
            {interview.transcript_stale && !reviewedTranscript && <Button disabled={locked} onClick={() => setReviewedTranscript(true)}>{t('cases.interviews.reviewTranscript')}</Button>}
          </Stack>}
          {interview.summary_stale && <Alert severity="warning">{t('cases.interviews.summaryStale')}</Alert>}
          <TextField label={t('cases.interviews.summary')} value={summary} multiline minRows={3} maxRows={9}
            onChange={(e) => setSummary(e.target.value)} disabled={busy}
            InputProps={{ readOnly: !canEdit }} inputProps={{ maxLength: 100_000 }} />
          {canEdit && <Stack direction="row" spacing={1}>
            <Button disabled={locked || !!draft || transcriptDirty || interview.transcript_stale || !transcript.trim()}
              onClick={() => void generate('summary')}>{t('cases.interviews.generateSummary')}</Button>
            {interview.summary_stale && !interview.transcript_stale && !reviewedSummary &&
              <Button disabled={locked} onClick={() => setReviewedSummary(true)}>{t('cases.interviews.reviewSummary')}</Button>}
          </Stack>}
          {draft && <>
            <Alert severity="info">{t(draft.target === 'transcript' ? 'cases.interviews.transcriptDraft' : 'cases.interviews.summaryDraft')}</Alert>
            <TextField value={draft.text} multiline maxRows={10} InputProps={{ readOnly: true }} />
            <Stack direction="row" spacing={1}>
              <Button onClick={() => {
                if (draft.target === 'transcript') {
                  setTranscript(draft.text);
                  setReviewedTranscript(true);
                } else {
                  setSummary(draft.text);
                  setReviewedSummary(true);
                }
                setDraft(null);
              }}>{t('cases.interviews.useDraft')}</Button>
              <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
            </Stack>
          </>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={locked} onClick={close}>{t('common.close')}</Button>
        {canEdit && <Button variant="contained" disabled={locked || !!draft || !(transcriptDirty || summaryDirty)} onClick={() => void save()}>{t('common.save')}</Button>}
      </DialogActions>
    </Dialog>
  );
}
