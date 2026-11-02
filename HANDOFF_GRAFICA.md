# Passaggio alla chat della grafica

Questa cartella contiene una PWA statica: non dipende dal Mac acceso e la pubblicazione prevista è GitHub Pages. L’utente ha chiesto che la grafica sia gestita in un’altra chat. Questa implementazione mantiene l’impostazione visiva precedente e aggiorna la parte funzionale.

Se esiste `DESIGN.md`, leggilo come riferimento della direzione grafica. Non è stato modificato da questo lavoro funzionale.

## Dove intervenire

- `public/app.css`: colori, tipografia, spaziature, tabelle, moduli e breakpoint.
- `public/index.html`: shell, navigazione, dialoghi e icone.
- `public/app.js`: markup delle viste e grafico SVG. Le funzioni `overview`, `balances`, `goal`, `backup`, `chart` e `monthlyTable` gestiscono la presentazione.
- Icone in `public/icon*.png` e `public/icon.svg`; metadati PWA in `manifest.webmanifest`.

La navigazione usa gli hash `#panoramica`, `#saldi`, `#obiettivo`, `#backup`. Le azioni usano `data-action`, `data-edit` e `data-year-step`. Conserva le etichette accessibili, i collegamenti dei form, gli ID usati dagli event listener e il focus dei dialoghi.

## Comportamenti da preservare

- Mese liberamente selezionabile, anche oltre il 2030; selettore anno senza elenco fisso di cinque anni.
- Importo e scadenza dell’obiettivo modificabili, anche dopo il 2030.
- Distinzione tra zero e saldo mancante. La percentuale con base nulla o negativa è `n.d.`.
- Un salto di mesi non va disegnato come una sequenza di saldi a zero o collegato nel grafico come dato continuo.
- L’archivio locale è in IndexedDB. Dopo configurazione e consenso di attivazione, viene sincronizzato con l’account personale Supabase. Conserva accesso tramite link e codice email, attivazione, stato sincronizzazione e scelte dei conflitti. Non introdurre altri servizi e non inserire saldi nel codice pubblico.
- I backup iniziali reali sono solo in `.private/` e `outputs/`, esclusi da Git e dalla build. Per provare i saldi usa l’importazione nell’interfaccia.
- Salvataggio precedente recuperabile e controllo delle revisioni tra finestre.
- Gli aggiornamenti della cache non cancellano i dati e richiedono conferma prima di ricaricare.
- La sincronizzazione avviene dopo un salvataggio, quando l’app torna online/in primo piano e ogni 20 secondi mentre è visibile. Mantieni chiaro che le modifiche offline restano sul dispositivo finché non può inviarle.
- Non reimpostare i moduli durante la digitazione quando arriva un aggiornamento remoto. Salvataggi da moduli aperti su versioni precedenti devono continuare a rilevare i conflitti.
- Non nascondere attivazione esplicita, email dell’account, errori e confronto dei valori in conflitto. Il progetto Supabase è già configurato: senza sessione va mostrato il modulo di accesso, compreso il campo per incollare il link dentro la PWA su iPhone. La configurazione vuota continua a mostrare l’avviso di servizio da configurare.

I moduli `model.js`, `storage.js`, `cloud-client.js`, `sync-engine.js`, `sync-merge.js`, `cloud.js`, `pwa.js` e `service-worker.js` sono separati per consentire il redesign senza riscrivere i dati o la logica finanziaria. Se aggiungi file usati offline, inseriscili nell’elenco `ASSETS` del service worker. `scripts/build.mjs` genera automaticamente la versione della cache.

La configurazione e la prova reale del servizio sono descritte in `SINCRONIZZAZIONE.md`. La funzione `cloudMarkup()` in `app.js` presenta accesso e conflitti; i moduli di sincronizzazione non richiedono modifiche per un redesign. Non mettere chiavi segrete in `cloud-config.js`.

## Verifica prima di consegnare

```sh
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

In sviluppo apri l’URL con `?dev=1`. Per testare la vera cache offline, serve la build `dist/` senza `?dev=1`. Il progetto funziona sotto un percorso GitHub come `/il-mio-conto/`: usa percorsi relativi per icone, script, CSS e moduli.

Controlla desktop e 375 px: niente tagli degli importi, dialoghi e input raggiungibili, grafico leggibile, tabelle con scorrimento interno e nessuno scorrimento laterale dell’intera pagina. L’utente farà l’installazione finale su iPhone fisico.
