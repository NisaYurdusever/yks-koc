import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
await import('dotenv/config').catch(() => {}); // dotenv kuruluysa .env'i yükler, yoksa sorun değil

process.on('uncaughtException', (e) => console.error('Beklenmeyen hata:', e));
process.on('unhandledRejection', (e) => console.error('Beklenmeyen hata:', e));

const app = express();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELS = (process.env.MODEL || 'gemini-3.8-flash,gemini-3.1-flash-lite-preview').split(',').map((s) => s.trim());
const FILE = 'data.json';
const load = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { exams: [] });
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.use(express.json({ limit: '40mb' }));
app.use(express.static('public'));

async function gen(contents, max, system) {
  let last;
  for (const model of MODELS) {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await ai.models.generateContent({
          model, contents,
          config: { maxOutputTokens: max, ...(system ? { systemInstruction: system } : {}) },
        });
        return r.text;
      } catch (e) {
        last = e;
        const m = String(e.message);
        if (e.status === 404 || /"code":\s*404/.test(m)) break; // model yok, sıradakine geç
        if (!(e.status === 503 || e.status === 429 || /"code":\s*(503|429)/.test(m))) throw e;
        await sleep(2000 * 2 ** i);
      }
    }
  }
  throw last;
}
const ask = (content, max = 24000) =>
  gen([{ role: 'user', parts: typeof content === 'string' ? [{ text: content }] : content }], max);

const EXTRACT = `Bu bir YKS deneme sınavı sonuç karnesi (herhangi bir okul, dershane veya yayın). SADECE geçerli JSON döndür, başka metin yazma:
{"kaynak":"kurum veya yayın adı","denemeler":[{"ad":"","tarih":"GG.AA.YYYY","net":0}],"dersler":[{"ders":"Fizik","ss":28,"d":17,"y":10,"b":1}],"konular":[{"ders":"Türkçe","konu":"","ss":0,"d":0,"y":0,"b":0}]}
Kurallar:
- "dersler": karnedeki ders toplam satırları (varsa). "konular": konu bazlı tablodan oku. Alt konu satırları üst konuyu tekrar ediyorsa SADECE üst seviye konuları al (çift sayma olmasın). Ders toplam satırlarını konulara ekleme.
- ss=soru sayısı, d=doğru, y=yanlış, b=boş. Tablolarda boş hücreler atlanmış olabilir; bir sayının Y mi B mi olduğunu sütun hizasına (başlığın altında hangi sütunda durduğuna) bakarak belirle. Emin değilsen y ve b için null yaz, tahmin etme.
- Bir dersin konularındaki ss toplamı o dersin ss toplamına eşit olmalı. Eşit değilse eksik konu vardır, tabloyu tekrar tara ve hepsini ekle.
- Ders adlarını TYT/AYT öneki olmadan yaz (Türkçe, Matematik, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, Felsefe, Din Kültürü, Edebiyat...). Tamamı boş bırakılmış seçmeli dersleri ekleme.
- Sınav netleri varsa denemeler listesine koy; yoksa net=null. Tek sınavsa tek eleman.
- Tablo yoksa ilgili dizi boş olsun.`;

const SYS = `Sen deneyimli bir YKS koçusun. Türkçe, samimi, somut ve kısa cevap ver. Cevaplarda öğrencinin verisini kullan; gün, saat ve soru sayısı ver. Veride olmayan bilgiyi uydurma; bilmiyorsan söyle. Doğru/yanlış/boş verisinde "?" olan yerler bilinmiyor demektir.`;

app.get('/api/data', (_, res) => res.json(load()));

app.post('/api/upload', async (req, res) => {
  try {
    const { name, b64 } = req.body;
    const text = await ask([{ inlineData: { mimeType: 'application/pdf', data: b64 } }, { text: EXTRACT }]);
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const num = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(+v) ? +v : null);
    const t = (j.konular || []).map((k) => {
      const ss = num(k.ss) || 0, d = num(k.d) || 0, y = num(k.y);
      let b = num(k.b);
      if (y != null && b == null) b = Math.max(0, ss - d - y);
      return { ders: String(k.ders), konu: String(k.konu), ss, d, y, b };
    }).filter((k) => k.ss > 0);
    const dersler = (j.dersler || []).map((x) => ({ ders: String(x.ders), ss: num(x.ss) || 0, d: num(x.d) || 0, y: num(x.y), b: num(x.b) }));
    // Konulardaki Y/B toplamı ders toplamıyla tutmuyorsa Y/B güvenilmezdir: bilinmiyor say
    for (const s of dersler) {
      const ks = t.filter((k) => k.ders === s.ders);
      if (!ks.length || s.y == null) continue;
      const sy = ks.reduce((a, k) => a + (k.y ?? NaN), 0), sb = ks.reduce((a, k) => a + (k.b ?? NaN), 0);
      if (sy !== s.y || sb !== s.b) ks.forEach((k) => { k.y = null; k.b = null; });
    }
    if (!t.length && !(j.denemeler || []).length) throw new Error('Karnede okunabilir veri bulunamadı');
    const data = load();
    const exam = {
      id: crypto.randomUUID(), file: name, src: j.kaynak || 'Bilinmiyor', added: new Date().toISOString(),
      nets: (j.denemeler || []).map((n) => ({ ad: n.ad, tarih: n.tarih, net: num(n.net) })), dersler, t,
    };
    data.exams.push(exam);
    save(data);
    res.json(exam);
  } catch (e) {
    console.error(e);
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
  try { res.json({ text: await gen([{ role: 'user', parts: [{ text: req.body.prompt }] }], 10000, SYS) }); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
    res.json({ text: await gen(contents, 8000, SYS + '\n\nÖğrenci verileri:\n' + context) });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.listen(3000, () => console.log('YKS Koç: http://localhost:3000'));