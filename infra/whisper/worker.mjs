import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';

const maxAudio = 10 * 1024 * 1024;
const maxOutput = 400_000;
const demuxers = new Set(['wav', 'ogg', 'matroska', 'mov', 'mp3']);
const model = process.env.WHISPER_MODEL;
if (!model?.startsWith('/models/') || model.slice(8).includes('/')) throw new Error('Select a model file under /models');
await access(model);

function localProcess(path, args, input, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
    const chunks = [];
    let size = 0;
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      child.kill('SIGKILL');
      reject(new Error('transcription failed'));
    };
    const timeout = setTimeout(fail, timeoutMs);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) fail();
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!failed && code === 0) resolve(Buffer.concat(chunks, size));
      else fail();
    });
    child.stdin.end(input);
  });
}

async function transcribe(audio, demuxer) {
  // Keep decoded audio bounded and prevent the input from loading external files or URLs.
  const pcm = await localProcess('/usr/bin/ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'pipe', '-f', demuxer,
    '-i', 'pipe:0', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
  ], audio, 3600 * 16000 * 2, 60_000);
  if (!pcm.length || pcm.length % 2) throw new Error('invalid PCM');
  const header = Buffer.from('524946460000000057415645666d74201000000001000100803e0000007d0000020010006461746100000000', 'hex');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.writeUInt32LE(pcm.length, 40);
  // Use the pinned CLI’s segment callback; its file-output stdout mode reopens /dev/stdout.
  return localProcess('/opt/whisper/whisper-cli', ['-m', model, '-t', '2', '-l', 'auto', '-f', '-', '-of', 'unused', '-nt', '-np'],
    Buffer.concat([header, pcm]), maxOutput, 5 * 60_000);
}

let processing = false;
createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.url === '/health') return res.writeHead(204).end();
  if (req.method !== 'POST' || req.url !== '/transcribe') return res.writeHead(404).end();
  if (req.headers.origin || !/^(whisper:8080|127\.0\.0\.1:\d{1,5})$/.test(req.headers.host ?? '')) return res.writeHead(403).end();
  const demuxer = req.headers['x-audio-format'];
  const size = Number(req.headers['content-length']);
  if (!demuxers.has(demuxer) || !Number.isSafeInteger(size) || size < 12 || size > maxAudio) return res.writeHead(400).end();
  if (processing) return res.writeHead(429).end();
  processing = true;
  req.setTimeout(15_000, () => req.destroy());
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > size) throw new Error('invalid content length');
      chunks.push(chunk);
    }
    if (total !== size) throw new Error('invalid content length');
    req.setTimeout(0);
    const output = await transcribe(Buffer.concat(chunks, total), demuxer);
    if (!output.length) throw new Error('empty transcript');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(output);
  } catch {
    if (!res.destroyed) res.writeHead(422).end();
  } finally {
    processing = false;
  }
}).listen(8080, '0.0.0.0');
