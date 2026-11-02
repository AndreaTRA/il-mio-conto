# Pubblicare l’app con GitHub Pages

**Progetto attuale già pubblicato:** [apri l’app](https://andreatra.github.io/il-mio-conto/) · [repository](https://github.com/AndreaTRA/il-mio-conto). Repository, workflow e Pages sono già configurati: per il primo utilizzo parti dal punto 4. I punti 1–3 servono solo per ricreare la pubblicazione.

La versione pubblicata funziona dal telefono anche a Mac spento. Dopo il primo caricamento completo e la preparazione offline può aprirsi senza connessione. GitHub ospita il programma; saldi e note sono conservati nel browser e, dopo l’attivazione, nel tuo archivio personale Supabase.

Il progetto Supabase è già stato creato e `public/cloud-config.js` è compilato. Segui [SINCRONIZZAZIONE.md](SINCRONIZZAZIONE.md) per il primo accesso tramite link email e per impostare il Site URL dopo la pubblicazione. Nessun saldo personale è contenuto nel codice.

## 1. Crea il repository

Su [GitHub](https://github.com/new) crea un repository, per esempio `il-mio-conto`, senza aggiungere inizialmente README o altri file. Con GitHub Free, GitHub Pages è disponibile nei repository pubblici. Il codice dell’app può essere pubblico perché non contiene i saldi personali.

Non inserire nel repository `.private/`, `outputs/`, gli estratti PDF o i backup personali. Il sito Pages è pubblico anche quando un piano consente di usare un repository privato.

## 2. Carica il progetto

Apri un terminale nella cartella di questo progetto. I seguenti comandi aggiungono solo i sorgenti necessari. Sostituisci `TUO_UTENTE` e `TUO_REPOSITORY` con il tuo account e il repository appena creato:

```sh
git add public scripts tests supabase package.json .gitignore README.md PUBBLICAZIONE.md SINCRONIZZAZIONE.md HANDOFF_GRAFICA.md .github/workflows/pages.yml
git commit -m "Crea web app offline per il conto"
git remote add origin https://github.com/TUO_UTENTE/TUO_REPOSITORY.git
git push -u origin main
```

Completa l’autenticazione GitHub se richiesta. Se il repository locale ha già un remoto, controlla `git remote -v` e usa quello corretto invece di aggiungerne un secondo.

Chi preferisce l’interfaccia di GitHub può caricare i sorgenti del pacchetto `progetto-github-pages.zip`: il pacchetto contiene soltanto codice, documentazione e icone. Il backup dei saldi è un file separato.

## 3. Attiva Pages

Nel repository apri:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

È già presente il workflow `.github/workflows/pages.yml`. Poi vai in **Actions → Test e pubblicazione web app → Run workflow** e scegli `main`. Se il primo tentativo era partito prima dell’attivazione di Pages, rieseguilo dopo aver selezionato la sorgente corretta.

Il workflow esegue i test, crea `dist/` e pubblica esclusivamente quei file. Attendi che i job `build` e `deploy` siano completati. L’indirizzo effettivo è mostrato nella pagina **Settings → Pages** e nell’ambiente `github-pages`; sarà normalmente:

```text
https://TUO_UTENTE.github.io/TUO_REPOSITORY/
```

Usa HTTPS e mantieni lo slash finale. Non occorrono computer acceso, porte sul router o server Node in esecuzione.

## 4. Aggiungi l’app alla Home dell’iPhone

1. Apri l’indirizzo pubblicato in Safari, mentre sei online.
2. Tocca Condividi e scegli **Aggiungi alla schermata Home**. Se disponibile, attiva l’apertura come app web.
3. Apri l’app dalla nuova icona Home.
4. Attendi lo stato **Disponibile offline**. Per il primo caricamento serve la connessione.
5. In **Backup e dispositivi → Importa backup**, scegli `saldi-iniziali-da-importare.json`, disponibile separatamente in questa chat/cartella `outputs`.
6. Controlla il riepilogo dell’importazione e conferma. I 10 saldi iniziali da gennaio a ottobre 2026 saranno caricati sul dispositivo.
7. Accedi tramite il link email (oppure con il codice, se configurato) e scegli **Attiva sincronizzazione**. Sul secondo dispositivo usa la stessa email e attiva il collegamento: i dati vengono scaricati dall’archivio online, senza reimportare il backup iniziale.

Importa il backup dentro l’app aperta dalla Home: il suo archivio può essere distinto da quello della scheda Safari.

## 5. Controllo sul telefono

Chiudi l’app, spegni il computer e aprila di nuovo dalla Home. Poi, dopo aver verificato **Disponibile offline**, prova a riaprirla con il telefono in modalità aereo e registra un saldo di prova. Il salvataggio deve rimanere visibile dopo la chiusura e la riapertura. Elimina infine il saldo di prova o ripristina il backup.

Dopo l’attivazione, ripeti il controllo con telefono e computer aperti e online: un nuovo saldo deve arrivare sull’altro dispositivo. Il salvataggio offline verrà sincronizzato alla successiva apertura online. Se entrambi cambiano lo stesso valore, la pagina **Backup e dispositivi** chiede quale conservare. La guida [SINCRONIZZAZIONE.md](SINCRONIZZAZIONE.md) descrive anche accesso, email e prova dei conflitti.

## Aggiornamenti e grafica

Ogni push su `main` avvia test e pubblicazione. Le modifiche al codice non riscrivono i saldi, che rimangono nel browser. Quando l’app rileva una nuova versione propone **Aggiorna app**. Salva prima le eventuali modifiche aperte.

Mantieni stabile l’indirizzo del sito: i dati sono associati all’origine e al percorso dell’app. Prima di cambiare account, repository, dominio o telefono, esporta un backup.

## Fonti ufficiali

- [Configurazione della sorgente GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Pubblicazione automatica con GitHub Actions](https://docs.github.com/en/get-started/start-your-journey/deploying-your-website-automatically)
- [App web nella Home di iPhone](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios)
- [Funzionamento offline delle PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
