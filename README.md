# Flowly

[Apri l’app](https://andreatra.github.io/il-mio-conto/) · [Repository GitHub](https://github.com/AndreaTRA/il-mio-conto)

Web app personale installabile sulla Home dell’iPhone, con archivio sul dispositivo e funzionamento offline dopo il primo caricamento completo. Il computer può restare spento. GitHub Pages distribuisce i file dell’app; Supabase gestisce l’accesso personale e la sincronizzazione quando configurato.

## Funzioni

- Saldi al primo giorno di qualsiasi mese, senza un termine nel 2030.
- Confronti mensili in euro e percentuale, crescita complessiva e riepilogo annuale.
- Importo e scadenza dell’obiettivo modificabili. L’obiettivo iniziale resta 50.000 € al 31 dicembre 2030.
- Archivio IndexedDB, salvataggio precedente recuperabile e controllo dei conflitti fra finestre.
- Backup JSON, importazione dei vecchi backup a 60 mesi e CSV per Excel o Numbers.
- PWA con cache offline e aggiornamenti su conferma, senza cancellare l’archivio.
- Pubblicazione statica su GitHub Pages, senza processi sul Mac.
- Sincronizzazione Supabase tramite link o codice email, con salvataggio offline, unione delle modifiche indipendenti e risoluzione esplicita dei conflitti.

Ogni dispositivo mantiene una copia locale. Dopo la configurazione e l’attivazione sul proprio account, le copie si aggiornano automaticamente mentre l’app è aperta e online. Il progetto Supabase personale è stato creato a Francoforte e il collegamento pubblico è già configurato. Database e autorizzazioni sono stati verificati con dati fittizi, poi annullati. Nessun saldo personale è stato caricato: GitHub Pages è attivo e la prima pubblicazione è riuscita. Resta da effettuare il primo accesso personale e importare il backup dall’app.

## Pubblicazione e primo utilizzo

Segui [SINCRONIZZAZIONE.md](SINCRONIZZAZIONE.md) per Supabase e [PUBBLICAZIONE.md](PUBBLICAZIONE.md) per GitHub Pages e l’installazione su iPhone.

Il backup personale dei saldi iniziali si trova in `outputs/saldi-iniziali-da-importare.json` ed è escluso da Git. Importalo dalla web app dopo averla aggiunta alla Home dell’iPhone. Non caricarlo nel repository. Un’app nuova parte con un archivio vuoto: nessun saldo personale è incorporato nel sito pubblico.

## Sviluppo

Occorre Node.js 22 o successivo. Non ci sono dipendenze da installare.

```sh
npm run dev
```

Se nel terminale è disponibile solo Node, i comandi equivalenti sono:

```sh
node scripts/serve.mjs
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/serve.mjs --dist
```

`npm run dev` apre un server di sviluppo su `http://localhost:8791/?dev=1`. Questa modalità evita di installare la cache offline, per vedere subito le modifiche alla grafica. Il server di sviluppo serve solo a lavorare sul codice: non è necessario quando l’app è pubblicata.

Per provare la PWA completa usa `npm run build` e poi `npm run preview`, senza `?dev=1` nell’indirizzo. Se una vecchia cache sta controllando la stessa origine, applica l’aggiornamento proposto dall’app. Per una verifica offline pulita usa un’altra porta, per esempio `CONTO_PORT=8792 node scripts/serve.mjs --dist`.

## Verifiche

```sh
npm test
npm run build
```

I test coprono anni oltre il 2030, date e importi, saldi a zero, mesi mancanti, migrazione dei backup, riepiloghi annuali, CSV e cache offline sotto il percorso GitHub. Simulano inoltre autenticazione, due dispositivi, modifiche offline, concorrenza durante l’invio e conflitti. La prova con un progetto Supabase reale richiede la configurazione personale descritta nella guida. La build pubblica esclusivamente `public/` e genera una versione della cache dal contenuto dei file.

## Struttura

| File | Responsabilità |
|---|---|
| `public/app.js` | Interfaccia, navigazione e moduli |
| `public/app.css` | Grafica e layout responsive |
| `public/model.js` | Importi, date, saldi, statistiche e migrazione |
| `public/storage.js` | IndexedDB, revisioni e recupero |
| `public/cloud-config.js` | URL e chiave pubblicabile del progetto Supabase |
| `public/cloud-client.js` | REST Auth, rinnovo sessione e accesso al database |
| `public/sync-engine.js` | Sincronizzazione, versioni e coda offline |
| `public/sync-merge.js` | Unione a tre vie e conflitti per campo |
| `supabase/schema.sql` | Tabella, regole di accesso e salvataggio con controllo versione |
| `public/pwa.js` | Registrazione offline e aggiornamenti |
| `public/service-worker.js` | Cache dei soli file dell’app |
| `scripts/build.mjs` | Build statica in `dist/` |
| `.github/workflows/pages.yml` | Test, build e deploy GitHub Pages |

[HANDOFF_GRAFICA.md](HANDOFF_GRAFICA.md) contiene le indicazioni per la chat che si occuperà della grafica.

## Dati e limiti pratici

Il saldo è una fotografia del conto al primo giorno del mese, prima dei movimenti del giorno. Un mese vuoto non vale zero. La variazione mensile richiede due mesi consecutivi; un denominatore nullo o negativo produce `n.d.` nella percentuale. I riepiloghi annuali confrontano il primo e l’ultimo saldo disponibile nell’anno.

La quota mensile per raggiungere l’obiettivo è calcolata dalla data odierna e dall’ultimo saldo già disponibile, include un versamento nel mese in corso e non ipotizza rendimenti futuri. I saldi riferiti a mesi futuri non contano come denaro già disponibile. Una scadenza superata non impedisce di registrare nuovi mesi. Il calendario gestisce gli anni da 1 a 9999, senza un orizzonte finanziario prefissato.

I dati del browser possono andare persi cancellando l’archivio del sito o reinstallando l’app. Conserva un backup prima di cambiare telefono o indirizzo del sito. Safari e l’app aggiunta alla Home possono avere archivi separati: importa i dati aprendo l’app dall’icona Home.

La sincronizzazione richiede lo stesso account Supabase sui dispositivi. I dati online sono riservati all’utente tramite RLS; non sono cifrati end-to-end. I controlli avvengono a salvataggio, riapertura, ritorno online e ogni 3 secondi mentre l’app è visibile. Non richiede che il Mac resti acceso.

Il sito non si collega alla banca. I nuovi saldi si inseriscono manualmente.
