import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useT } from './i18n';

const MAX_BYTES = 10 * 1024 * 1024;
const recordings = [ ['audio/webm;codecs=opus', 'webm'], ['audio/mp4', 'm4a'], ['audio/ogg;codecs=opus', 'ogg'] ];

export function CaseInterviewAudioInput({ file, setFile, disabled, setRecording }: {
  file: File | null;
  setFile: (file: File | null) => void;
  disabled: boolean;
  setRecording: (value: boolean) => void;
}) {
  const t = useT();
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const alive = useRef(false);
  const supported = typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
    ? recordings.find(([type]) => MediaRecorder.isTypeSupported(type)) : undefined;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const current = recorder.current;
      if (current?.state === 'recording') current.stop();
      current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const choose = (next: File) => {
    if (!next.size || next.size > MAX_BYTES) {
      setError('interview-audio-too-large');
      return;
    }
    setError('');
    setFile(next);
  };

  const start = async () => {
    if (!supported || active || disabled) return;
    const [mimeType, extension] = supported;
    setError('');
    setActive(true);
    setRecording(true);
    let stream: MediaStream | undefined;
    const finish = () => {
      stream?.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      if (alive.current) {
        setActive(false);
        setReady(false);
        setRecording(false);
      }
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) return finish();
      const current = new MediaRecorder(stream, { mimeType });
      recorder.current = current;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      current.ondataavailable = ({ data }) => {
        size += data.size;
        if (size > MAX_BYTES) {
          failed = true;
          if (alive.current) setError('interview-audio-too-large');
          if (current.state === 'recording') current.stop();
        } else if (data.size) chunks.push(data);
      };
      current.onerror = () => {
        failed = true;
        if (alive.current) setError('record-error');
        finish();
      };
      current.onstop = () => {
        if (!failed && alive.current) choose(new File(chunks, `interview.${extension}`, { type: current.mimeType }));
        finish();
      };
      current.start(1000);
      setReady(true);
    } catch {
      if (alive.current) setError('record-error');
      finish();
    }
  };

  return (
    <Stack spacing={1}>
      <Typography variant="caption">{t('cases.interviews.audioHelp')}</Typography>
      {error && <Alert severity="error">{t(`cases.interviews.${error}`)}</Alert>}
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button component="label" variant="outlined" disabled={disabled || active}>
          {t('cases.interviews.chooseAudio')}
          <input hidden type="file" accept=".wav,.mp3,.m4a,.mp4,.webm,.ogg,audio/*" onChange={(e) => {
            if (e.target.files?.[0]) choose(e.target.files[0]);
            e.target.value = '';
          }} />
        </Button>
        {supported && <Button variant="outlined" disabled={disabled || (active && !ready)} onClick={() => {
          if (active) {
            if (recorder.current?.state === 'recording') recorder.current.stop();
            setReady(false);
          }
          else void start();
        }}>{t(`cases.interviews.${active ? 'stopRecording' : 'recordAudio'}`)}</Button>}
        {file && <Button disabled={disabled || active} onClick={() => setFile(null)}>{t('common.cancel')} · {file.name}</Button>}
      </Stack>
    </Stack>
  );
}
