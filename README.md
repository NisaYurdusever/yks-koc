# YKS Koç

Her kurumdan (okul, dershane, yayın) deneme karnesi PDF'i yükle; Claude PDF'i okur, konu bazlı D/Y/B ve net takibi yapılır.

## Kurulum
1. Node.js 18+ kur.
2. `npm install`
3. API anahtarı al (console.anthropic.com) ve ayarla:
   - Mac/Linux: `export ANTHROPIC_API_KEY=sk-ant-...`
   - Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-..."`
4. `npm start` → http://localhost:3000

Veriler `data.json` dosyasında tutulur (yedeklemek için kopyala). Model: varsayılan `claude-sonnet-5-5`, `MODEL` ortam değişkeniyle değiştirilir.
Not: Her PDF yüklemesi API kullanır (ücretlidir).
