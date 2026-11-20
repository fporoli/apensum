import { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import type { CaseInterview } from '../shared/cases';
import { useT } from '@worktime3/web/plugin';
import { CaseInterviewAudioInput } from './CaseInterviewAudioInput';
import { openInterview, sealedBody } from '../shared/caseVault';
import { openFile, sealFile } from './caseVaultClient';

export async function interviewResponse(res: Response) {
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(res.status === 413 ? 'interview-audio-too-large' : data?.message ?? data?.error);
  return data;
}

/** Text for an API error code: the shared AI codes (cases.ai.error.*) first, then the interview ones. */
export function caseErrorText(code: string, t: ReturnType<typeof useT>, prefix: string): string | null {
  for (const key of [`cases.ai.error.${code}`, `${prefix}${code}`]) if (code && t(key) !== key) return t(key);
  return null;
}

export function interviewError(error: unknown, t: ReturnType<typeof useT>) {
  const message = error instanceof Error ? error.message : '';
  return caseErrorText(message, t, 'cases.interviews.') ?? t('cases.interviews.operationFailed');
}

/** Who handles transcription / summaries for this organization (GET interviews); null = chosen but not set up. */
export interface InterviewAiProviders {
  transcription: 'azure' | null;
  /** What the organization chose, to say which provider is missing. */
  transcriptionSetting: 'azure' | 'off';
  summary: 'local' | 'azure' | null;
}

export function CaseInterviewEditor({ interview, url, authHeaders, canEdit, transcriptionEnabled, providers, getKey, computeUrl, onChange, onClose }: {
  interview: CaseInterview;
  url: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  transcriptionEnabled: boolean;
  providers: InterviewAiProviders;
  /** Set for an encrypted case: the case key. Text and audio are sealed in the browser; server AI gets them per request. */
  getKey?: () => Promise<CryptoKey | null>;
  /** The stateless jobs of an encrypted case (transcription, summary): the text or audio is sent for that call only. */
  computeUrl?: string;
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
  const providerName = (p: string) => t(`cases.ai.provider.${p}`);
  // When a transcription started (ms), so the dialog can show how long the provider has been working.
  const [transcribingSince, setTranscribingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (transcribingSince === null) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - transcribingSince) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [transcribingSince]);

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

  /** A stateless call for an encrypted case: what the server needs comes in the request, nothing is stored there. */
  const computeCall = async (job: string, body: FormData) => {
    const headers = await authHeaders();
    delete headers['Content-Type'];
    delete headers['content-type'];
    return interviewResponse(await fetch(`${computeUrl}/${job}`, { method: 'POST', headers, body }));
  };

  /** A generated text: straight into its field while that is empty (still to be saved), else a draft to compare first. */
  const offer = (target: 'transcript' | 'summary', text: string) => {
    const current = target === 'transcript' ? transcript : summary;
    if (current.trim()) return setDraft({ target, text });
    if (target === 'transcript') {
      setTranscript(text);
      setReviewedTranscript(true);
    } else {
      setSummary(text);
      setReviewedSummary(true);
    }
  };

  /** A summary of the transcript as it stands in the editor, saved or not. */
  const summarize = () => run(async () => {
    if (getKey) {
      const form = new FormData();
      form.set('data', JSON.stringify({ name: interview.interviewee_name, role: interview.interviewee_role, date: interview.interview_date, transcript }));
      offer('summary', (await computeCall('summarize', form)).draft);
      return;
    }
    offer('summary', (await request('/summarize', 'POST', { revision: interview.revision, transcript })).draft);
  });

  /** The audio, plain: the chosen file, or the stored one (decrypted here when the case is encrypted). */
  const plainAudio = async (chosen: File | null): Promise<Blob> => {
    if (chosen) return chosen;
    const res = await fetch(`${url}/audio`, { headers: await authHeaders(), cache: 'no-store' });
    if (!res.ok) await interviewResponse(res);
    const key = getKey ? await getKey() : null;
    if (!key) return res.blob();
    if (!interview.audio_key) throw new Error('no-case-key');
    return new Blob([await openFile(interview.audio_key, 'audio', interview.id, await res.arrayBuffer())], { type: interview.audio_mime || 'audio/webm' });
  };

  const uploadAudio = async (chosen: File): Promise<CaseInterview> => {
    const form = new FormData();
    form.append('revision', interview.revision);
    const key = getKey ? await getKey() : null;
    if (key) {
      // Sealed: the audio as ciphertext, and its type in the interview's `enc` (re-sealed with the saved texts).
      const sealedAudio = await sealFile('audio', interview.id, await chosen.arrayBuffer());
      form.append('enc', JSON.stringify((await sealedBody(key, 'interview', interview.id, {
        interviewee_name: interview.interviewee_name, transcript_text: interview.transcript_text, summary: interview.summary, tags: interview.tags,
        audio_mime: chosen.type || null, audio_key: sealedAudio.fileKey,
      })).enc));
      form.append('file', sealedAudio.blob, 'interview-audio.bin');
    } else form.append('file', chosen);
    const { interview: saved } = await request('/audio', 'PUT', form);
    const next = key ? await openInterview(key, saved) : saved;
    setAudio(null);
    setAudioUrl('');
    onChange(next);
    setFile(null);
    return next;
  };

  /** Attaches a chosen file first if there is one, then waits for the transcription draft. */
  const transcribe = () => run(async () => {
    const chosen = file;
    const revision = file ? (await uploadAudio(file)).revision : interview.revision;
    setTranscribingSince(Date.now());
    try {
      let data;
      if (getKey) {
        const form = new FormData();
        form.set('file', await plainAudio(chosen), 'interview-audio');
        data = await computeCall('transcribe', form);
      } else data = await request('/transcribe', 'POST', { revision });
      offer('transcript', data.draft);
    } finally {
      setTranscribingSince(null);
    }
  });

  const save = () => run(async () => {
    const form = new FormData();
    const key = getKey ? await getKey() : null;
    form.append('data', JSON.stringify(key
      ? { revision: interview.revision, ...(await sealedBody(key, 'interview', interview.id, {
          interviewee_name: interview.interviewee_name, transcript_text: transcript, summary: summary.trim() ? summary : null, tags: interview.tags, audio_mime: interview.audio_mime ?? null, audio_key: interview.audio_key ?? null,
        })) }
      : { revision: interview.revision,
        ...(transcriptDirty ? { transcript_text: transcript } : {}),
        ...(summaryDirty ? { summary: summary.trim() ? summary : null } : {}),
      }));
    const { interview: saved } = await request('', 'PATCH', form);
    const next = key ? await openInterview(key, saved) : saved;
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
            setAudio(await plainAudio(null));
          })}>{t('cases.interviews.playAudio')}</Button>)}
          {canEdit && <>
            <CaseInterviewAudioInput file={file} setFile={setFile} disabled={busy} setRecording={setRecording} />
            {file && <Button disabled={locked || !!draft} onClick={() => void run(async () => { await uploadAudio(file); })}>
              {t(interview.has_audio ? 'cases.interviews.replaceAudio' : 'cases.interviews.attachAudio')}
            </Button>}
            {(interview.has_audio || file) && <Stack spacing={1}>
              <Stack direction="row" spacing={1}>
                <Button variant="contained"
                  disabled={locked || !!draft || !transcriptionEnabled}
                  onClick={() => void transcribe()}>
                  {t(file ? 'cases.interviews.attachAndTranscribe' : 'cases.interviews.generateTranscript')}
                </Button>
                {interview.transcript_stale && !reviewedTranscript && <Button disabled={locked} onClick={() => setReviewedTranscript(true)}>{t('cases.interviews.reviewTranscript')}</Button>}
              </Stack>
              {providers.transcription && <Typography variant="caption" color="text.secondary">
                {t('cases.ai.sendsTo', { provider: providerName(providers.transcription) })}
              </Typography>}
              {!transcriptionEnabled && <Alert severity="info">
                {t(providers.transcriptionSetting === 'off' ? 'cases.interviews.interview-transcription-disabled' : 'cases.ai.error.ai-provider-not-configured')}
              </Alert>}
              {transcribingSince !== null && <Alert severity="info" icon={<CircularProgress size={20} />}>
                {t('cases.interviews.transcribing', { seconds: String(elapsed), provider: providerName(providers.transcription ?? 'azure') })}
              </Alert>}
            </Stack>}
          </>}
          {interview.transcript_stale && <Alert severity="warning">{t('cases.interviews.transcriptStale')}</Alert>}
          <TextField label={t('cases.interviews.transcriptText')} value={transcript} multiline minRows={4} maxRows={14}
            onChange={(e) => setTranscript(e.target.value)} disabled={busy}
            InputProps={{ readOnly: !canEdit }} inputProps={{ maxLength: 100_000 }} />
          {interview.summary_stale && <Alert severity="warning">{t('cases.interviews.summaryStale')}</Alert>}
          <TextField label={t('cases.interviews.summary')} value={summary} multiline minRows={3} maxRows={9}
            onChange={(e) => setSummary(e.target.value)} disabled={busy}
            InputProps={{ readOnly: !canEdit }} inputProps={{ maxLength: 100_000 }} />
          {canEdit && <Stack direction="row" spacing={1} alignItems="center">
            <Button disabled={locked || !!draft || !transcript.trim() || !providers.summary}
              variant="outlined"
              onClick={() => void summarize()}>{t('cases.interviews.generateSummary')}</Button>
            <Typography variant="caption" color="text.secondary">
              {providers.summary
                ? t('cases.ai.sendsTo', { provider: providerName(providers.summary) })
                : t('cases.ai.error.ai-provider-not-configured')}
            </Typography>
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
