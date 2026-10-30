import { PROFILE_KEYS, PROFILE_MAX_BYTES, makeProfile, validateProfile } from './profile-format.js';
const form = document.querySelector('#profile-form');
const input = document.querySelector('#import');
const message = document.querySelector('#message');
function notify(text, error = false) { message.textContent = text; message.className = error ? 'error' : ''; }
form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const values = Object.fromEntries(new FormData(form));
    const profile = makeProfile(values);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2) + '\n'], { type: 'application/json' }));
    link.download = 'site-profile.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    notify('Downloaded. Add the file to the repository root and rebuild; this page did not save changes to the site.');
  } catch (error) { notify(error.message, true); }
});
input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > PROFILE_MAX_BYTES) throw new Error('Site profile is too large');
    const profile = validateProfile(JSON.parse(await file.text()));
    if (!confirm('Replace the fields in this editor? Unsaved edits will be lost.')) return;
    for (const key of PROFILE_KEYS) form.elements.namedItem(key).value = profile.settings[key];
    notify('Imported into this editor only. Export and rebuild to publish.');
  } catch (error) { notify(error instanceof SyntaxError ? 'Invalid JSON file' : error.message, true); }
  finally { input.value = ''; }
});
