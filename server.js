import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELS = (process.env.MODEL || 'gemini-3.8-flash,gemini-3.1-flash-lite-preview').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = 'data.json';
const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { exams: [] });
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));

app.use(express.json({ limit: '40mb' }));
app.use(express.static('public'));

async function ask(content, max = 16000) {
  const parts = typeof content === 'string' ? [{ text: content }] : content;
  let last;
  for (const model of MODELS) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { maxOutputTokens: max },
        });
        return r.text;
      } catch (e) {
        last = e;
        const msg = String(e.message);
        if (e.status === 404 || /"code":\s*404/.test(msg)) break;
        if (!(e.status === 503 || e.status === 429 || /"code":\s*(503|429)/.test(msg))) throw e;
        await sleep(2000 * 2 ** i);
      }
    }
  }
  throw last;
}

const EXTRACT = `Bu bir YKS deneme sınavı sonuç karnesi (herhangi bir okul, dershane veya yayın). SADECE geçerli JSON döndür, başka metin yazma:
{"kaynak":"kurum veya yayın adı","denemeler":[{"ad":"","tarih":"GG.AA.YYYY","net":0}],"konular":[{"ders":"Türkçe","konu":"","ss":0,"d":0,"y":0,"b":0}]}
Kurallar:
- Konu bazlı tablodan oku. Alt konu satırları üst konuyu tekrar ediyorsa SADECE üst seviye konuları al (çift sayma olmasın). Ders toplam satırlarını konu olarak ekleme.
- ss=soru sayısı, d=doğru, y=yanlış, b=boş. Y ve B ayrı verilmemişse y ve b için null yaz, tahmin etme.
- Ders adlarını TYT/AYT öneki olmadan yaz (Türkçe, Matematik, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, Felsefe, Din Kültürü, Edebiyat...). Cevapsız bırakılmış seçmeli dersleri (tamamı boş) ekleme.
- Sınav netleri varsa denemeler listesine koy; yoksa net=null. Tek sınavsa tek eleman.
- Konu tablosu yoksa konular boş dizi olsun.`;

app.get('/api/data', (_, res) => res.json(load()));

app.post('/api/upload', async (req, res) => {
  try {
    const { name, b64 } = req.body;
    const text = await ask([
      { inlineData: { mimeType: 'application/pdf', data: b64 } },
      { text: EXTRACT },
    ]);
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const num = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : null);
    const t = (j.konular || []).map((k) => {
      const ss = num(k.ss) || 0, d = num(k.d) || 0;
      const y = num(k.y);
      let b = num(k.b);
      if (y != null && b == null) b = Math.max(0, ss - d - y);
      return { ders: String(k.ders), konu: String(k.konu), ss, d, y, b };
    }).filter((k) => k.ss > 0);
    if (!t.length && !(j.denemeler || []).length) throw new Error('Karnede okunabilir veri bulunamadı');
    const data = load();
    const exam = {
      id: crypto.randomUUID(), file: name, src: j.kaynak || 'Bilinmiyor', added: new Date().toISOString(),
      nets: (j.denemeler || []).map((n) => ({ ad: n.ad, tarih: n.tarih, net: num(n.net) })), t,
    };
    data.exams.push(exam);
    save(data);
    res.json(exam);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/exam/:id', (req, res) => {
  const d = load();
  d.exams = d.exams.filter((e) => e.id !== req.params.id);
  save(d);
  res.json({ ok: true });
});

app.post('/api/coach', async (req, res) => {
  try { res.json({ text: await ask(req.body.prompt, 4000) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(3000, () => console.log('YKS Koç: http://localhost:3000'));
