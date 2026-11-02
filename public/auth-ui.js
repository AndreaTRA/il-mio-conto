const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createAuthUi({ root, signIn, recover, verifyLink, resetPassword, onAuthenticated }) {
  let mode = 'loading', candidate = null;
  const brand = '<div class="auth-brand"><span class="brand-mark" aria-hidden="true">f</span><span>flowly</span></div>';
  function show(next = 'login', message = '') {
    mode = next; root.hidden = false;
    const heading = mode === 'forgot' ? 'Recupera la password' : mode === 'recovery' ? 'Scegli una nuova password' : mode === 'loading' ? 'Apro il tuo spazio…' : 'Bentornato.';
    const subtitle = mode === 'login' ? 'Accedi per ritrovare e sincronizzare i tuoi dati su telefono e computer.' : mode === 'forgot' ? 'Ti invieremo le istruzioni all’email associata al tuo account.' : mode === 'recovery' ? 'Il link è stato verificato. Imposta una password di almeno 12 caratteri.' : 'Verifico l’accesso al tuo account.';
    let fields = '';
    if (mode === 'login') fields = '<form id="login-form"><label for="login-name">Nome utente o email</label><input id="login-name" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="128" required><button class="button primary" type="submit">Accedi</button></form><button class="auth-link" type="button" data-auth-action="forgot">Password dimenticata?</button>';
    if (mode === 'forgot') fields = '<form id="forgot-form"><label for="recovery-name">Nome utente o email</label><input id="recovery-name" autocomplete="username" autocapitalize="none" spellcheck="false" required><button class="button primary" type="submit">Invia istruzioni</button></form><details><summary>Hai già il link? Incollalo qui</summary><p>Su iPhone dalla Home copia il link dell’email senza aprirlo e incollalo nell’app.</p><form id="recovery-link-form"><label for="recovery-link">Link di recupero</label><input id="recovery-link" type="password" autocomplete="off" required><button class="button secondary" type="submit">Verifica link</button></form></details><button class="auth-link" type="button" data-auth-action="login">Torna all’accesso</button>';
    if (mode === 'recovery') fields = '<form id="new-password-form"><label for="new-password">Nuova password</label><input id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="repeat-password">Ripeti la password</label><input id="repeat-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button class="button primary" type="submit">Salva password</button></form><button class="auth-link" type="button" data-auth-action="login">Annulla</button>';
    root.innerHTML = `<div class="auth-card">${brand}<p class="eyebrow">IL TUO SPAZIO PERSONALE</p><h1>${heading}</h1><p class="auth-subtitle">${subtitle}</p>${fields}<p id="auth-message" class="auth-message" role="status">${escape(message)}</p><p class="auth-footnote">Le password sono gestite da Supabase e non vengono salvate nel codice dell’app.</p></div>`;
  }
  function message(text, error = false) {
    const node = root.querySelector('#auth-message'); if (node) { node.textContent = text; node.classList.toggle('form-error', error); }
  }
  root.addEventListener('click', event => {
    const action = event.target.closest('[data-auth-action]')?.dataset.authAction;
    if (action) { candidate = null; show(action); }
  });
  root.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true; message('');
    try {
      if (form.id === 'login-form') {
        await signIn(root.querySelector('#login-name').value, root.querySelector('#login-password').value);
        await onAuthenticated();
      } else if (form.id === 'forgot-form') {
        await recover(root.querySelector('#recovery-name').value);
        message('Se l’account è presente e l’invio è disponibile, riceverai l’email con le istruzioni. Controlla anche lo spam.');
      } else if (form.id === 'recovery-link-form') {
        candidate = await verifyLink(root.querySelector('#recovery-link').value); show('recovery');
      } else if (form.id === 'new-password-form') {
        const password = root.querySelector('#new-password').value;
        if (password !== root.querySelector('#repeat-password').value) throw new Error('Le due password non coincidono.');
        await resetPassword(candidate, password); candidate = null; show('login', 'Password aggiornata. Accedi con la nuova password.');
      }
    } catch (error) { message(error.message, true); }
    finally { form.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; }); if (button.isConnected) button.disabled = false; }
  });
  return { show, message, get mode() { return mode; }, recovery(session) { candidate = session; show('recovery'); }, hide() { root.hidden = true; root.replaceChildren(); } };
}
