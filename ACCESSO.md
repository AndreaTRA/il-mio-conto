# Accesso personale a Flowly

La prima schermata dell’app è il login. La dashboard viene mostrata dopo l’accesso; uscire dall’account nasconde l’archivio locale senza eliminarlo. La pagina **Account e sicurezza**, raggiungibile da **Dispositivi**, mostra username ed email di recupero.

Le credenziali personali vengono consegnate separatamente in `outputs/Credenziali-Flowly.txt`, escluso da Git e dalla build. Non copiarle nei sorgenti o nel repository. La password casuale iniziale è stata inviata direttamente a Supabase Auth tramite HTTPS; nel database è conservata da Auth nel suo formato protetto, non nei file pubblici dell’app. L’utente deve confermare l’indirizzo con l’email di attivazione ricevuta da Supabase prima del primo accesso.

## Flusso quotidiano

1. Apri [Flowly](https://andreatra.github.io/il-mio-conto/). Se hai una vecchia versione installata, applica **Aggiorna app** o riaprila online.
2. Inserisci username oppure email e la password ricevuta. La password non viene salvata dall’app; il browser può proporre il proprio gestore password.
3. La sincronizzazione si collega automaticamente al tuo account dopo l’accesso. Da **Dispositivi** puoi importare il backup: i saldi importati vengono sincronizzati. Usa lo stesso account sul secondo dispositivo.
4. **Account e sicurezza** mostra l’email associata all’account. **Recupera o cambia password** invia le istruzioni a quell’indirizzo.

La sessione resta sul dispositivo per permettere le aperture successive e l’uso della copia locale offline. Il primo accesso richiede internet. Un archivio già collegato a un utente non viene mostrato a un altro account. Uscire rimuove la sessione, conserva i dati locali e riporta al login.

## Password dimenticata

Nella pagina iniziale scegli **Password dimenticata?**, inserisci username o email e richiedi le istruzioni. Il messaggio di conferma non rivela se esiste un account con quel nome. Il link ricevuto apre il modulo della nuova password; la nuova password deve avere da 12 a 128 caratteri e va ripetuta.

Su iPhone dalla Home puoi copiare il link di recupero senza aprirlo e incollarlo in **Hai già il link? Incollalo qui**. In questo modo il recupero resta dentro l’app. Il link viene verificato con Supabase e non viene seguito verso altri siti. Il recupero non apre automaticamente la dashboard: dopo il cambio si accede con la nuova password.

Non inviare link di recupero, codici o password in chat. I token contenuti nel ritorno dall’email vengono rimossi subito dall’indirizzo e verificati con Supabase prima di usarli.

L’invio email dipende dalla configurazione Auth del progetto. Il servizio email predefinito Supabase ha limiti e destinatari consentiti; per un servizio stabile o per cambiare destinatari configura un SMTP personale. [Documentazione SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Implementazione

| File | Compito |
| --- | --- |
| `public/auth-ui.js` | Login, richiesta recupero, verifica link e nuova password |
| `public/auth.css` | Stile della pagina di accesso, coerente con il tema esistente |
| `public/app.js` | Visibilità della dashboard, controllo proprietario e pagina account |
| `public/cloud-client.js` | Richieste Auth, sessione e recupero; nessuna persistenza della password |
| `supabase/functions/password-login/` | Verifica password tramite Supabase Auth e risoluzione dello username lato server |

Supabase Auth usa email e password. La funzione server risolve lo username tramite `app_metadata.login_username`, impostato dall’amministratore: ignora `user_metadata`, che l’utente può modificare. Le chiavi privilegiate vengono lette dalle variabili del server Supabase e non sono restituite al browser. Il controllo della password usa il normale endpoint Auth. La funzione accetta soltanto login e recupero e restituisce risposte generiche per credenziali errate. Sono presenti un limite di tentativi per istanza e i limiti del servizio Auth.

La funzione è predisposta per un progetto personale con meno di 1000 utenti. Per un servizio multiutente più ampio occorre sostituire la ricerca amministrativa con una tabella indicizzata di alias. Le autorizzazioni ai saldi continuano a dipendere da `auth.uid()` e dalle regole RLS, non dallo username.

Per distribuire la funzione usa `deploy_edge_function` o la CLI Supabase; `verify_jwt` è disabilitato perché questa è la porta di accesso per utenti ancora senza sessione e la funzione verifica direttamente la password con Auth. Non aggiungere operazioni amministrative pubbliche al suo handler.

Il login limita l’accesso nell’interfaccia e l’accesso ai dati online. I saldi e i backup locali non sono cifrati end-to-end: il proprietario del dispositivo può accedere al proprio archivio del browser. Conserva il dispositivo e i backup in modo appropriato.

L’Advisor del progetto segnala che il controllo aggiuntivo delle password già compromesse non è attivo. La password iniziale consegnata è casuale. [Indicazioni Supabase sulla protezione delle password](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Fonti: [password Auth](https://supabase.com/docs/guides/auth/passwords), [recupero](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [variabili server](https://supabase.com/docs/guides/functions/secrets).

## Home e statistiche

Nella Home l’importo mancante è in evidenza nel riquadro dell’obiettivo; il totale da raggiungere rimane più piccolo. La quota mensile compare una sola volta, nel piano di risparmio. Il dato storico aggiuntivo è la variazione media mensile: differenza tra ultimo e primo saldo divisa per i mesi di calendario trascorsi, anche se ci sono mesi senza rilevazioni.

## Notifiche mensili nell’app

La voce **Notifiche** del menu mostra un contatore dei saldi mancanti. Per ogni mese, dal giorno 1 compare il promemoria di inserire il saldo al primo giorno entro il 5. Dopo il 5 diventa **In ritardo** e resta visibile finché quel mese non ha un saldo. Il passaggio al mese successivo non lo elimina. Lo zero è un saldo valido; una nota senza importo non completa il promemoria.

I promemoria si riferiscono ai mesi dal primo mese presente nello storico fino al mese corrente; per un archivio vuoto si parte dal mese corrente. Non vengono richiesti saldi futuri. Le notifiche sono ricavate dai dati dell’account: salvare su un dispositivo le risolve anche sugli altri dopo la sincronizzazione. Dal promemoria puoi aprire direttamente il modulo del mese interessato.

Questi sono promemoria **dentro l’app**, nella sezione richiesta del menu. Si aggiornano all’apertura, al cambio giorno e dopo i salvataggi. Non viene richiesto il permesso per notifiche push del sistema e non vengono inviate email mensili.

## Stato connessione e piano di risparmio

La dicitura **Online / Sincronizzato** riguarda la connessione e l’archivio condiviso. La preparazione per l’uso offline indica invece che l’app può aprirsi anche senza rete: non significa che il dispositivo sia disconnesso. Quando l’app è visibile controlla gli aggiornamenti ogni 3 secondi, oltre che dopo i salvataggi e alla riapertura. In caso di errore di rete i tentativi si diradano. I conflitti non sovrascrivono automaticamente valori diversi.

Il riquadro **Da mettere da parte**, accanto all’obiettivo, usa la data odierna nel fuso Europe/Rome e l’ultimo saldo disponibile non successivo a oggi. La quota mensile è il denaro mancante diviso per i mesi da oggi alla scadenza, contando un versamento anche nel mese in corso. Si arrotonda per eccesso al centesimo, senza ipotizzare interessi. Non si conta come già disponibile un saldo inserito per un mese futuro. Nessun saldo disponibile produce una richiesta di inserimento, non un saldo fittizio a zero.
# Numeri nascosti

L’occhio nell’intestazione mostra o nasconde importi e percentuali nelle schermate e nello storico. Il grafico rimane nascosto insieme ai numeri. Ogni nuova apertura o ritorno dall’app in secondo piano riparte con i dati nascosti: la scelta di mostrarli non viene salvata. I campi per inserire o modificare un saldo rimangono utilizzabili.


## Account degli amici e amministrazione

Dal login scegli **Non hai un account? Richiedi l’accesso**. Inserisci nome, cognome, email, telefono e una password di almeno 12 caratteri. Conferma l’email ricevuta: l’accesso ai saldi rimane in attesa dell’approvazione. Il telefono è un recapito visibile all’amministratore, non viene verificato via SMS.

Andrea trova **Gestione utenti** in **Dispositivi → Account e sicurezza**. Le richieste sono ordinate per stato: in attesa, attivi, rifiutati e bloccati. Può approvare, rifiutare, bloccare e riattivare; il proprio account amministratore è protetto da queste operazioni. Il pannello mostra recapiti e conferma email, non i saldi degli altri utenti. Usa **Aggiorna** per caricare nuove richieste.

Le autorizzazioni sono salvate in `conto_profiles`, non nei metadati modificabili dall’utente. I nuovi account sono sempre in attesa. Solo l’UUID verificato dell’amministratore esistente viene abilitato dalla migrazione `supabase/accounts.sql`, da applicare dopo `supabase/schema.sql`. Le funzioni privilegiate sono nello schema privato con permessi espliciti e controllano il chiamante. Il client non può modificare direttamente profili e ruoli. L’account bloccato perde immediatamente lettura e scrittura online anche con token ancora valido; l’interfaccia lo riporta al login al controllo successivo. L’accesso offline già autorizzato può continuare fino alla riconnessione.

Gli archivi locali, il salvataggio precedente e le copie dei conflitti sono separati per account. La migrazione copia il vecchio archivio soltanto nel relativo account, conservando gli originali. Gli account nuovi partono vuoti. Il cambio di sessione in un’altra scheda nasconde la dashboard precedente.

Verifiche: test unitari client e sincronizzazione, prova browser con API simulate (registrazione, approvazione, cambio account, conservazione archivio, blocco), transazione sul database reale con utenti fittizi annullata integralmente (RLS, scrittura, falsi ruoli nei metadati, privilegi amministratore, protezione del proprietario). Nessuna prova invia email o modifica i saldi reali. Configurazione Auth verificata: registrazione consentita e conferma email richiesta.
