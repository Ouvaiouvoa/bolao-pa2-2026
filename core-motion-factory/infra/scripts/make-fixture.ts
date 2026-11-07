/**
 * Generates the raw-footage fixture used by integration, visual and E2E tests:
 * a 16:9 "talking head" recording in Brazilian Portuguese with real synthesized speech
 * (Piper voice via sherpa-onnx), natural pauses, a false start, a retake, a sensitive claim
 * and a spoken CTA. The pipeline must discover all of this on its own — the script text is
 * stored separately only to measure ASR accuracy in tests.
 *
 *   npm run fixture:generate
 */
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "@cmf/media";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MODELS = process.env.CMF_MODELS_DIR ?? path.join(ROOT, ".models");
const VOICE = path.join(MODELS, "vits-piper-pt_BR-faber-medium");
const OUT_DIR = path.join(ROOT, "tests/fixtures");

/** [text, pause after (ms)] — pauses create silences for detection and jump cuts. */
const SCRIPT: [string, number][] = [
  ["Hum, deixa eu começar de novo.", 900],
  ["Você sabia que três em cada quatro pessoas abandonam um vídeo nos primeiros três segundos?", 1100],
  ["Você sabia que três em cada quatro pessoas abandonam um vídeo nos primeiros três segundos?", 800],
  ["O primeiro erro é começar sem um gancho claro.", 700],
  ["O segundo erro é falar com todo mundo ao mesmo tempo, sem definir o público.", 750],
  ["E o terceiro erro é esquecer de dizer o que a pessoa deve fazer depois de assistir.", 1200],
  ["Com um roteiro simples, a sua marca ganha atenção, confiança e mais clientes.", 650],
  ["Resultado garantido, cem por cento, sem nenhum risco.", 900],
  ["Então comente a palavra roteiro aqui embaixo, que eu te mando o modelo.", 1000],
];

interface Tts {
  generate(req: { text: string; sid: number; speed: number }): { samples: Float32Array; sampleRate: number };
}

function wavBuffer(samples: Float32Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32767))), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function main() {
  const require = createRequire(import.meta.url);
  const sherpa = require("sherpa-onnx-node") as { OfflineTts: new (cfg: unknown) => Tts };
  const tts = new sherpa.OfflineTts({
    model: { vits: { model: `${VOICE}/pt_BR-faber-medium.onnx`, tokens: `${VOICE}/tokens.txt`, dataDir: `${VOICE}/espeak-ng-data` }, numThreads: 2 },
    maxNumSentences: 1,
  });

  const tmp = await mkdtemp(path.join(os.tmpdir(), "cmf-fixture-"));
  await mkdir(OUT_DIR, { recursive: true });
  const parts: Float32Array[] = [];
  let sampleRate = 22050;
  const timeline: { text: string; startMs: number; endMs: number }[] = [];
  let cursor = 0;
  // Lead-in room tone.
  const lead = 600;
  parts.push(new Float32Array(Math.round((lead / 1000) * sampleRate)));
  cursor += lead;
  for (const [text, pause] of SCRIPT) {
    const audio = tts.generate({ text, sid: 0, speed: 1.0 });
    sampleRate = audio.sampleRate;
    parts.push(audio.samples);
    const durMs = (audio.samples.length / sampleRate) * 1000;
    timeline.push({ text, startMs: Math.round(cursor), endMs: Math.round(cursor + durMs) });
    cursor += durMs;
    parts.push(new Float32Array(Math.round((pause / 1000) * sampleRate)));
    cursor += pause;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const speech = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    speech.set(p, off);
    off += p.length;
  }
  const speechWav = path.join(tmp, "speech.wav");
  await writeFile(speechWav, wavBuffer(speech, sampleRate));
  const durationSec = total / sampleRate;

  // Presenter silhouette (head + torso) with alpha, generated procedurally.
  const presenter = path.join(tmp, "presenter.png");
  const head = "lte(hypot(X-180,Y-150),92)";
  const torso = "lte(pow((X-180)/175,2)+pow((Y-560)/250,2),1)";
  await ffmpeg([
    "-f", "lavfi", "-i", "color=c=black:s=360x560,format=rgba",
    "-frames:v", "1",
    "-vf",
    `geq=r='if(${head},214,if(${torso},40,0))':g='if(${head},160,if(${torso},96,0))':b='if(${head},124,if(${torso},120,0))':a='if(${head}+${torso},255,0)'`,
    presenter,
  ]);

  // Camera A until ~55% of the take, then camera B (scene change) with a different backdrop.
  const cut = (durationSec * 0.55).toFixed(2);
  const out = path.join(OUT_DIR, "raw-talk-pt.mp4");
  await ffmpeg([
    "-f", "lavfi", "-i", `gradients=s=1280x720:c0=0x1d3557:c1=0x0b132b:x0=0:y0=0:x1=1280:y1=720:speed=0.002:r=30:d=${durationSec.toFixed(2)}`,
    "-f", "lavfi", "-i", `gradients=s=1280x720:c0=0x3a2e39:c1=0x14110f:x0=1280:y0=0:x1=0:y1=720:speed=0.002:r=30:d=${durationSec.toFixed(2)}`,
    "-loop", "1", "-framerate", "30", "-i", presenter,
    "-i", speechWav,
    "-filter_complex",
    [
      `[1:v][0:v]overlay=enable='lt(t,${cut})'[bg]`,
      // Subject sits off-centre (≈35% of width) and sways — reframing must find it.
      `[bg][2:v]overlay=x='300+14*sin(t*1.3)':y='190+5*sin(t*2.7)':shortest=1:enable='lt(t,${cut})'[a]`,
      `[a][2:v]overlay=x='560+10*sin(t*1.1)':y='170+4*sin(t*2.1)':shortest=1:enable='gte(t,${cut})'[b]`,
      `[b]drawbox=x=40:y=36:w=150:h=40:color=black@0.45:t=fill,drawtext=fontfile=/usr/share/fonts/opentype/inter/Inter-Bold.otf:text='CAM':x=58:y=44:fontsize=24:fontcolor=white,format=yuv420p[v]`,
    ].join(";"),
    "-map", "[v]", "-map", "3:a",
    "-t", durationSec.toFixed(2),
    "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-r", "30",
    "-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "1",
    "-movflags", "+faststart",
    out,
  ]);
  await writeFile(
    path.join(OUT_DIR, "raw-talk-pt.script.json"),
    JSON.stringify({ note: "Texto de referência APENAS para medir precisão da transcrição em testes. Nunca é lido pelo pipeline.", voice: "piper pt_BR faber-medium", durationSec, sentences: timeline }, null, 2) + "\n",
  );
  await rm(tmp, { recursive: true, force: true });
  console.log(`fixture: ${out} (${durationSec.toFixed(1)}s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
