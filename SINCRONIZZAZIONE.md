# Attivare telefono e computer sullo stesso archivio

Il progetto Supabase **il-mio-conto** è stato creato nell’organizzazione **AndreaTRA's Money**, nella regione europea di Francoforte. Lo schema è applicato e `public/cloud-config.js` contiene già URL e chiave pubblicabile. Le prove reali di isolamento utenti, blocco degli accessi anonimi e controllo versione sono passate. Per usare l’app manca la pubblicazione su GitHub Pages e il tuo primo accesso. Il Mac può restare spento: GitHub distribuisce l’app e Supabase conserva l’archivio online. Nessun saldo personale è stato inviato online. Gli utenti e i dati fittizi delle prove sono stati annullati con rollback.

[Apri il progetto Supabase](https://supabase.com/dashboard/project/wasdrzcxzlgdqqcjsnup)

## 1. Prepara Supabase

Per il progetto attuale, creazione e schema sono già completati. I passi 1–3 seguenti servono solo se vuoi ricreare il servizio in un altro progetto. I passi sull’email spiegano le due modalità di accesso.

1. Apri [Supabase Dashboard](https://supabase.com/dashboard) e crea un progetto dedicato a questa app. Scegli una regione europea se preferisci conservare l’archivio in Europa.
2. Apri **SQL Editor**, crea una query, incolla tutto il file `supabase/schema.sql` ed eseguilo. Non contiene saldi né credenziali.
3. Lo script crea una tabella con un archivio per utente, accesso in lettura limitato al proprietario e una funzione che salva solo se la versione online è ancora quella letta. Non disattivare RLS e non aggiungere autorizzazioni generali di scrittura.
4. In **Authentication → Providers → Email**, abilita l’accesso email e la conferma dell’indirizzo. Lascia consentita la registrazione per il primo accesso; dopo aver creato il tuo utente puoi disabilitare le nuove registrazioni, mantenendo l’accesso degli utenti esistenti.
5. Puoi usare subito le email standard con link di accesso. Per usare invece un codice numerico, configura prima un tuo SMTP: nei nuovi progetti Free il servizio predefinito non consente di modificare i modelli email. [Modifica del 3 giugno 2026](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
6. Solo per il codice numerico: in **Authentication → Email Templates**, imposta sia **Magic Link** sia **Confirm signup** in modo che il corpo contenga il codice, per esempio:

```html
<h2>Il mio conto</h2>
<p>Il tuo codice di accesso è: <strong>{{ .Token }}</strong></p>
<p>Inseriscilo nell’app sul dispositivo da collegare.</p>
```

L’app supporta sia il link predefinito sia il codice numerico, se presente nell’email. I modelli email supportano la variabile `.Token`. [Documentazione dei modelli](https://supabase.com/docs/guides/auth/auth-email-templates)

Il servizio email predefinito di Supabase è destinato alle prove, con limiti di invio e destinatari autorizzati nel team del progetto. Per un utilizzo stabile configura **Custom SMTP** in Authentication usando un servizio email a tua scelta. Se il codice non arriva, controlla destinatario autorizzato, spam, limiti e log Auth. [Configurazione SMTP ufficiale](https://supabase.com/docs/guides/auth/auth-smtp)

## 2. Collega il codice al progetto

Nella schermata **Connect** del progetto o nelle impostazioni **API Keys**, copia il Project URL e la chiave **Publishable**. Modifica `public/cloud-config.js`:

```js
export const cloudConfig = {
  url: 'https://RIFERIMENTO-PROGETTO.supabase.co',
  publishableKey: 'INCOLLA_LA_CHIAVE_PUBLISHABLE'
};
```

Questa configurazione è pubblica e viene inclusa nel sito. La chiave publishable è prevista per il browser; le autorizzazioni effettive dipendono dall’utente autenticato e dalle regole del database. Non inserire chiavi **secret**, **service_role**, password del database o token personali. La build rifiuta le chiavi segrete riconosciute. [Chiavi API](https://supabase.com/docs/guides/getting-started/api-keys), [regole RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

Nel progetto consegnato questi valori sono già compilati. Se li cambi, esegui i test e la build. Poi pubblica seguendo `PUBBLICAZIONE.md`. In **Authentication → URL Configuration**, imposta come Site URL l’indirizzo HTTPS definitivo di GitHub Pages, completo del percorso del repository. Questo permette al link di riaprire il sito corretto. In alternativa puoi copiare il link email e incollarlo direttamente nell’app: questa modalità verifica il token con Supabase e non usa l’indirizzo di ritorno. Su iPhone dalla Home è la modalità consigliata, perché Safari e l’app possono avere archivi distinti.

## 3. Primo dispositivo: carica i tuoi saldi una volta

1. Apri l’app pubblicata. Su iPhone aggiungila alla Home da Safari e poi aprila dall’icona.
2. In **Backup e dispositivi**, importa il file personale `saldi-iniziali-da-importare.json` se i tuoi dati non sono già presenti. Verifica che ci siano i 10 saldi da gennaio a ottobre 2026.
3. Nella stessa pagina inserisci la tua email e scegli **Invia email di accesso**. Su iPhone dalla Home, tieni premuto il link nell’email, copialo senza aprirlo e incollalo nel campo **Link ricevuto via email** dell’app; premi **Accedi con il link**. La verifica avviene solo con il tuo progetto Supabase. Sul computer puoi anche aprire il link, se hai impostato il Site URL, e confermare l’email mostrata. Se il modello email contiene un codice numerico, puoi usare il campo del codice. Non incollare link o codici di accesso in chat.
4. Premi **Attiva sincronizzazione**. La conferma indica l’account e l’invio dell’archivio a Supabase: questo è il passaggio che collega e carica i tuoi dati.
5. Attendi **Sincronizzato**. Se esiste già un archivio online, le modifiche compatibili vengono unite; eventuali valori diversi richiedono una scelta.

Non caricare il backup personale su GitHub. Un semplice accesso con email non invia automaticamente un archivio locale ancora scollegato.

## 4. Secondo dispositivo

Apri lo stesso indirizzo sul computer o sul secondo dispositivo, entra con **la stessa email** e attiva la sincronizzazione. Un archivio locale nuovo e vuoto scarica i saldi già presenti online. Non serve reimportare il vecchio backup.

La sessione resta sul dispositivo. Se scade, l’app prova a rinnovarla; se serve, richiede nuovamente l’accesso email. Uscire dall’account conserva i saldi locali e le modifiche ancora da inviare. Per riprendere usa lo stesso account.

## Come si comporta ogni giorno

- Il salvataggio locale funziona anche offline. Le modifiche vengono inviate quando l’app è aperta e torna online.
- Online il controllo parte dopo un salvataggio, alla riapertura o al ritorno in primo piano, e circa ogni 20 secondi mentre l’app è visibile. Puoi usare anche **Sincronizza ora**.
- Non è necessario lasciare accesi Mac o iPhone. La copia online rimane disponibile; un dispositivo chiuso invierà le sue modifiche locali alla successiva apertura online. Non è prevista esecuzione continua in background.
- Modifiche a mesi diversi, o alla nota e all’importo dello stesso mese, vengono unite quando compatibili. Se entrambi cambiano lo stesso valore, la pagina mostra i valori in conflitto: **Usa valori del dispositivo** o **Usa valori online** risolve i soli conflitti, mantenendo le altre modifiche compatibili.
- Prima di risolvere puoi esportare la copia online; il precedente salvataggio locale resta recuperabile. Se nel frattempo cambiano i dati, l’app richiede di riesaminare il conflitto.
- Eliminazioni, importazioni di backup e ripristini diventano modifiche da sincronizzare. Un vecchio backup può quindi sostituire dati recenti anche sugli altri dispositivi: esporta una copia aggiornata prima di importarlo.

L’archivio locale è associato all’account e al progetto scelti all’attivazione. Non cambiarli su un archivio già collegato. Per usare un altro account/progetto, esporta prima i dati e parti da un profilo browser o da un archivio locale nuovo; la normale uscita non rimuove l’associazione.

## Prova finale su due dispositivi

1. Verifica i tuoi saldi su entrambi dopo lo stato **Sincronizzato**.
2. Su un mese libero oltre il 2030 inserisci un saldo di prova sul primo dispositivo e controlla che compaia sul secondo aperto e online.
3. Metti il primo offline, modifica la nota e riaprilo: deve conservarla. Torna online e verifica l’arrivo della nota sul secondo.
4. Per provare il conflitto, modifica lo stesso importo sui due dispositivi mentre uno è offline. Ricollegalo e verifica la richiesta di scelta. Elimina poi il mese di prova e attendi la sincronizzazione.
5. Esporta un backup aggiornato e conservalo fuori dal repository.

I 37 test automatici simulano due dispositivi, rete, autenticazione e link email. Sul progetto reale sono già stati verificati schema, RLS, isolamento tra utenti, controllo versione, validazione delle date e rifiuto di letture/scritture anonime. Le prove hanno lasciato zero archivi e zero utenti fittizi. La prova completa con il tuo accesso e due dispositivi resta da fare dopo la pubblicazione; non è stata inviata alcuna email di accesso dall’assistente.

## Dati e disponibilità

GitHub riceve solo il codice pubblico. Attivando la sincronizzazione invii a Supabase saldi, note e obiettivo associati al tuo utente. Il collegamento usa HTTPS e l’accesso nel database è riservato al proprietario; non è una cifratura end-to-end e gli amministratori del progetto conservano l’accesso amministrativo. Proteggi gli account e mantieni un backup indipendente.

Servono connessione e servizio Supabase disponibile per sincronizzare; in caso di disservizio i dati già salvati sul dispositivo restano utilizzabili. Verifica nel tuo account condizioni, limiti ed eventuali costi del piano scelto: l’app non attiva abbonamenti e non richiede un server sul tuo computer.
