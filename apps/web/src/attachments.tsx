import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { AttachFileIcon } from './icons';
import { formatFileSize } from './localeFormat';

/** Same limits as the API (documents.service.ts MAX_DOCUMENT_BYTES, requests.controller.ts MAX_ATTACHMENTS). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export interface Attachment {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

/** A pasted screenshot arrives as "image.png"; give it a name worth keeping. */
function namedFile(file: File, pasted: boolean): File {
  if (!pasted || (file.name && file.name !== 'image.png')) return file;
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return new File([file], `screenshot-${stamp}.${ext}`, { type: file.type });
}

/**
 * Files queued for a message: added by the paperclip button, dropped on the composer, or pasted
 * (screenshots and copied files) into its text field. Too large or too many files are refused
 * with a message, before anything is sent.
 */
export function useAttachmentDraft(onError: (message: string) => void, options: { max?: number } = {}) {
  // `max: 1` is a single slot (an expense's receipt): a new file replaces the previous one.
  const max = options.max ?? MAX_ATTACHMENTS;
  const { t, locale } = useI18n();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const add = useCallback(
    (incoming: File[], pasted = false) => {
      if (incoming.length === 0) return;
      setFiles((current) => {
        const next = max === 1 ? [] : [...current];
        for (const raw of max === 1 ? incoming.slice(-1) : incoming) {
          const file = namedFile(raw, pasted);
          if (file.size > MAX_ATTACHMENT_BYTES) {
            onError(t('attachments.tooLarge', { name: file.name, max: formatFileSize(MAX_ATTACHMENT_BYTES, locale) }));
          } else if (next.length >= max) {
            onError(t('attachments.tooMany', { max: String(max) }));
            break;
          } else {
            next.push(file);
          }
        }
        return next;
      });
    },
    [onError, t, locale, max],
  );

  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length === 0) return; // plain text: let the field handle it
    e.preventDefault();
    add(pasted, true);
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      setDragging(false);
      add(Array.from(e.dataTransfer.files));
    },
  };

  const button = (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={max > 1}
        hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <Tooltip title={t('attachments.add')}>
        <IconButton size="small" aria-label={t('attachments.add')} onClick={() => inputRef.current?.click()}>
          <AttachFileIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </>
  );

  const chips =
    files.length > 0 ? (
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {files.map((f, i) => (
          <Chip
            key={`${f.name}-${i}`}
            size="small"
            icon={<AttachFileIcon fontSize="small" />}
            label={`${f.name} (${formatFileSize(f.size, locale)})`}
            onDelete={() => setFiles((current) => current.filter((_, j) => j !== i))}
            sx={{ maxWidth: '100%' }}
          />
        ))}
      </Box>
    ) : null;

  return { files, clear: () => setFiles([]), onPaste, dropProps, dragging, button, chips };
}

/** Outline shown around a composer while files are dragged over it. */
export function DropZone({ dragging, dropProps, children }: { dragging: boolean; dropProps: ReturnType<typeof useAttachmentDraft>['dropProps']; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Box
      {...dropProps}
      sx={{
        position: 'relative',
        borderRadius: 1,
        outline: dragging ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: 4,
      }}
    >
      {children}
      {dragging && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            opacity: 0.92,
            pointerEvents: 'none',
            borderRadius: 1,
          }}
        >
          <Typography variant="body2" color="primary">{t('attachments.drop')}</Typography>
        </Box>
      )}
    </Box>
  );
}

/**
 * A sent attachment: images show as a thumbnail (fetched with the caller's credentials, since the
 * download needs them), everything else as a chip. Clicking downloads the file.
 */
export function AttachmentView({ attachment, url, authHeaders }: { attachment: Attachment; url: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [preview, setPreview] = useState<string | null>(null);
  const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(attachment.mime_type);

  useEffect(() => {
    if (!isImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { headers: await authHeaders() });
        if (!res.ok) return;
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setPreview(objectUrl);
      } catch { /* the chip still offers the download */ }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, isImage, authHeaders]);

  async function download() {
    try {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) return;
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = attachment.file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { /* offline */ }
  }

  const label = `${attachment.file_name} (${formatFileSize(attachment.size_bytes, locale)})`;
  if (isImage && preview) {
    return (
      <Tooltip title={t('attachments.download', { name: label })}>
        <Box
          component="img"
          src={preview}
          alt={attachment.file_name}
          onClick={() => void download()}
          sx={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 1, cursor: 'pointer', bgcolor: 'background.paper' }}
        />
      </Tooltip>
    );
  }
  return (
    <Chip
      size="small"
      icon={<AttachFileIcon fontSize="small" />}
      label={label}
      onClick={() => void download()}
      sx={{ maxWidth: '100%', bgcolor: 'background.paper' }}
    />
  );
}
