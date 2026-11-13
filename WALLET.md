# Conti separati e pagamenti Apple Pay

## Stato della modifica

L’utente ha autorizzato esplicitamente l’attivazione in chat il 13 novembre 2026, inclusi ricezione delle spese tramite codici revocabili e pubblicazione. La precedente richiesta della revisione automatica è quindi risolta. Il frontend richiede la migrazione `supabase/wallet.sql` prima della pubblicazione. La migrazione `wallet_multi_account_monthly_verification` è stata applicata con successo al progetto esistente. Verificati in produzione disponibilità della ricezione, gestione dei codici riservata agli utenti autenticati, tabelle private non leggibili e accettazione del formato 3. I test con account fittizi sono stati mantenuti nel database locale: la revisione automatica ha rifiutato la loro esecuzione in produzione; la verifica online è stata sostituita con controlli senza scritture su account personali.

Sono passati 97 test JavaScript, la build e i test SQL su PostgreSQL 16 locale isolato. Nell’anteprima sono stati provati aggiunta di Fineco e Revolut, movimento associato al conto, totale, conservazione dopo riapertura, privacy, correzione del saldo esatto e guida Apple Pay. Non è comparso scorrimento orizzontale a 320 e 375 px. Il primo pagamento reale deve ancora essere verificato sull’iPhone dell’utente. Non sono stati letti dati bancari o modificati archivi personali remoti.

## Comportamento

Il menu verticale su desktop elenca tutti i conti e offre “Aggiungi conto”. Selezionare un conto apre saldo e movimenti filtrati e lo propone nel modulo per un nuovo movimento. La pagina Account offre “Aggiungi conto” e “Gestisci i conti”; su telefono la barra inferiore include “Conti”.

Sotto il riepilogo storico compaiono “I miei conti”, il totale in euro e gli ultimi movimenti. “Conti e tutti i movimenti” apre l’elenco completo con filtro per conto e paginazione. Aggiungere ciascun conto con il suo saldo preciso attuale; non occorrono IBAN, numero della carta o credenziali bancarie.

Il saldo di ogni conto è il saldo verificato più i movimenti successivi. Un’uscita Fineco diminuisce Fineco e il totale, lasciando invariato Revolut. Entrate, rimborsi, bonifici e spese non intercettate si inseriscono manualmente. Per trasferire denaro fra conti registrare un’uscita e un’entrata dello stesso importo. “Gestisci” permette di rinominare, correggere il saldo attuale o escludere un conto dal totale. La correzione crea un nuovo riferimento temporale: i movimenti precedenti rimangono visibili, già compresi nel saldo. “Annulla” conserva la transazione nello storico e ne rimuove l’effetto sul saldo.

“Verifica saldi” apre un modulo con il saldo corretto di tutti i conti o attività nominati dall’utente. Nessun conto può essere omesso. Data, importi individuali, nomi e somma vengono conservati nella fotografia mensile. Se la verifica è più recente dell’ultimo saldo di un conto, ne aggiorna il riferimento, così entrate non viste da Wallet vengono comprese e vecchie spese non vengono sottratte di nuovo. Le verifiche storiche non riportano indietro saldi più recenti. La data effettiva viene mostrata nella tabella ed esportata nel CSV. Le fotografie precedenti alla modifica conservano il significato originale di saldo al primo giorno del mese. I movimenti non riscrivono lo storico.

Il promemoria mensile nell’app rimane attivo finché tutti i conti inclusi risultano verificati; un nuovo conto riapre la verifica del mese corrente. Non sono notifiche push di iOS mentre l’app è chiusa.

La preferenza dell’occhio viene salvata nel dispositivo, separatamente per ciascun utente. Saldi visibili o nascosti rimangono nella condizione scelta dopo riapertura e passaggio ad altre app. La disconnessione nasconde i valori e la preferenza viene ripristinata al prossimo accesso dello stesso utente. Gli importi sono memorizzati in centesimi interi. Per questa versione sono supportati solo EUR, massimo 100 conti e 10.000 movimenti per archivio.

## Attivazione

1. Applicare integralmente `supabase/wallet.sql` al progetto Supabase già configurato, mediante migrazione versionata. Non cambiare i proprietari degli archivi né i profili esistenti.
2. Verificare le nuove funzioni e i privilegi; effettuare un test controllato senza conservare dati fittizi nei conti dell’utente.
3. Pubblicare la build del frontend con gli asset nuovi del service worker. Gli archivi precedenti vengono letti e migrati al formato 3 senza inventare conti. Il server rifiuta un vecchio client che tenta di sovrascrivere con il formato 2 un archivio già aggiornato.
4. Su iPhone applicare l’aggiornamento, aggiungere i conti e attendere “Sincronizzato”. Per ogni conto usare “Collega Apple Pay”: la finestra contiene le istruzioni complete e i valori da copiare in Comandi Rapidi.
5. Attivare una sola automazione per carta, selezionando esclusivamente la carta corrispondente. Verificare il primo pagamento reale prima di affidarsi al saldo stimato.

## Dati ricevuti dall’automazione

POST all’endpoint `/rest/v1/rpc/conto_wallet_ingest` del progetto. Intestazioni `apikey` con la chiave pubblicabile e `Content-Type: application/json`. Corpo JSON con campi di tipo testo:

| Campo | Contenuto |
| --- | --- |
| `p_token` | Codice casuale generato dall’app per il singolo conto |
| `p_event_id` | Identificativo stabile del pagamento, massimo 128 caratteri; per esempio data ISO più numero casuale |
| `p_amount` | Importo positivo senza raggruppamenti: `12,50` oppure `12.50` |
| `p_merchant` | Esercente, massimo 140 caratteri |
| `p_currency` | Valuta verificata dell’importo: solo `EUR` |
| `p_occurred_at` | Data ISO 8601 con fuso orario, per esempio `2026-11-13T16:00:00+01:00` |

Non etichettare automaticamente come EUR un importo di valuta sconosciuta. Nell’automazione verificare la valuta; quando l’input non la espone, richiedere conferma dell’importo in euro. Un pagamento in altra valuta va registrato manualmente con l’importo effettivo in euro.

Conservare lo stesso identificativo, data e contenuto quando si ritenta un invio. Il server risponde solo `{"status":"ok"}` oppure `{"status":"duplicate"}` e non restituisce il saldo. Se Comandi Rapidi genera un nuovo identificativo a ogni tentativo, questo è un nuovo evento: la deduplicazione non può riconoscerlo come ritentativo. Non configurare più automazioni per la stessa carta. Con connessione assente l’invio non è garantito: impostare una notifica di errore e recuperare il movimento manualmente.

## Accesso e riservatezza

Il codice contiene circa 244 bit casuali; nel database viene conservata solo l’impronta SHA-256. Non è una sessione dell’utente, non può leggere dati, non può registrare entrate e non consente di scegliere un altro conto. Chi possiede il codice può però inserire spese fittizie in quel conto: trattarlo come un segreto. Si revoca nell’app e rigenerandolo il precedente smette di funzionare. I codici non sono salvati nel backup e non sono recuperabili dopo la chiusura della finestra.

La ricezione controlla anche l’approvazione del profilo e l’esistenza di un conto attivo. Le tabelle dei collegamenti e delle ricevute sono private, con RLS e senza accesso diretto per `anon` o `authenticated`. Le funzioni privilegiate usano un `search_path` vuoto e verificano l’identità o il codice prima di scrivere. La funzione pubblica di ricezione richiede il codice nel corpo; il codice non compare nell’URL. La chiave pubblicabile da sola non autorizza l’invio.

Snapshot e ricezione usano lo stesso blocco di riga e incrementano la versione. Gli invii concorrenti non si sovrascrivono; un client con copia precedente deve unire i movimenti prima di inviare il proprio archivio. Le ricevute conservano l’idempotenza anche dopo il ripristino di un backup. Un massimo di 120 nuovi invii per ora e per codice limita gli abusi sul singolo collegamento.

## Verifica riproducibile

`node --test tests/*.test.mjs` e `node scripts/build.mjs` eseguono test e build. `tests/wallet-database.sql` va eseguito esclusivamente sul database locale isolato via socket alla porta 55439, dopo gli script di schema. Il test verifica i ruoli effettivi `anon` e `authenticated`, isolamento fra utenti, codice vincolato al conto, duplicati, conflitti di versione, vecchi client, revoca, profili bloccati e ripristino; tutti i dati fittizi vengono annullati con ROLLBACK.

`scripts/wallet-qa.mjs` serve un’anteprima locale alla porta 8793 con dati fittizi e backend simulato. Non contatta Supabase. È escluso dalla build perché solo `public/` viene distribuita. Il codice mostrato nella guida di questa anteprima è fittizio e non autorizza alcun invio reale.

Fonti: [automazioni Transazione di Apple](https://support.apple.com/en-ae/guide/shortcuts/apd65c67538a/ios), [richieste API in Comandi Rapidi](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios), [formati data](https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios), [funzioni database Supabase](https://supabase.com/docs/guides/database/functions).

## Correzione sincronizzazione e apertura

Il formato 3, usato dai conti separati, richiede l’aggiornamento dei dispositivi rimasti al formato 2. La nuova versione distingue l’aggiornamento necessario da un backup danneggiato, mantiene l’accesso e i dati locali, permette di ricontrollare gli aggiornamenti e inizializza il service worker anche quando l’archivio locale richiede un’app più recente. L’aggiornamento non cancella IndexedDB o le preferenze. Un nuovo dispositivo con i vecchi valori iniziali ma senza dati scarica l’archivio effettivo senza creare un conflitto fittizio sull’obiettivo.

Apertura, accesso e ricaricamento tornano su Panoramica; un conflitto resta segnalato con un collegamento esplicito alla sincronizzazione. Il riquadro principale mostra il saldo totale aggiornato di tutti i conti inclusi. Anche obiettivo e piano mensile usano quel totale; variazioni e grafico rimangono riferiti allo storico mensile. L’avviso “Inizia con i tuoi dati” non compare quando esistono conti o la sincronizzazione è interrotta.

Per il proprietario è stata confrontata una copia privata dell’archivio online con il backup iniziale: tutti i saldi originari sono già presenti, insieme ai dati aggiunti in seguito. Non è stato sovrascritto o reinserito alcun importo personale; la copia di verifica rimane esclusa da Git e dalla build.
