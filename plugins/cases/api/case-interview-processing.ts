import { BadRequestException } from '@nestjs/common';

export const MAX_INTERVIEW_TEXT = 100_000;
export const INTERVIEW_AUDIO_SOURCE = 'cases.case_interviews';

// Pick the decoder from the file bytes, not the filename or caller-supplied MIME type.
export function interviewAudioFormat(bytes: Buffer) {
  if (bytes.length < 12) throw new BadRequestException('interview-audio-format');
  const start = bytes.toString('latin1', 0, 4);
  const kind = bytes.toString('latin1', 8, 12);
  if (start === 'RIFF' && kind === 'WAVE') return { mime: 'audio/wav', extension: 'wav', demuxer: 'wav' };
  if (start === 'OggS') return { mime: 'audio/ogg', extension: 'ogg', demuxer: 'ogg' };
  if (bytes.readUInt32BE(0) === 0x1a45dfa3 && bytes.subarray(4, 64).includes(Buffer.from('\x42\x82\x84webm', 'latin1'))) {
    return { mime: 'audio/webm', extension: 'webm', demuxer: 'matroska' };
  }
  if (bytes.toString('latin1', 4, 8) === 'ftyp') return { mime: 'audio/mp4', extension: 'm4a', demuxer: 'mov' };
  if (bytes.toString('latin1', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) {
    return { mime: 'audio/mpeg', extension: 'mp3', demuxer: 'mp3' };
  }
  throw new BadRequestException('interview-audio-format');
}

/** Extract representative source sentences, in their original order. No model, inference of facts or network. */
export function summarizeInterview(transcript: string) {
  const segmenter = new Intl.Segmenter('und', { granularity: 'sentence' });
  const sentences = [...new Set(transcript.split(/\n+/).flatMap((line) =>
    [...segmenter.segment(line)].map(({ segment }) => segment.trim()).filter(Boolean)))];
  const words = sentences.map((text) => [...new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? [])]);
  const frequency = new Map<string, number>();
  for (const list of words) for (const word of list) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  return words.map((list, index) => ({ index, score: list.reduce((sum, word) => sum + (frequency.get(word)! - 1), 0) / (list.length || 1) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4).sort((a, b) => a.index - b.index)
    .map(({ index }) => sentences[index].length > 400 ? `${sentences[index].slice(0, 399).trimEnd()}…` : sentences[index]).join('\n');
}
