/* TOOLBOX — collegamento a Supabase.
   Qui vanno SOLO l'indirizzo del progetto e la chiave PUBBLICA (publishable / anon):
   sono pensate per stare nel frontend, la sicurezza dei dati è data dalle regole RLS.
   MAI la chiave segreta (secret / service_role).
   Se i campi restano vuoti, la schermata di accesso li chiede una volta e li ricorda in questo browser. */
window.TOOLBOX_CONFIG = {
  supabaseUrl: "",   // es. "https://xxxxxxxx.supabase.co"
  supabaseKey: ""    // es. "sb_publishable_..."
};
