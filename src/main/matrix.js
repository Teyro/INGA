'use strict';

/**
 * Mahnungen über Element (Matrix-Messenger, https://element.io) verschicken.
 * Kein SDK, keine neue Abhängigkeit – nur einfache HTTPS-Aufrufe gegen die
 * Matrix Client-Server-API über das in Node 22 eingebaute `fetch()`.
 *
 * Ablauf für eine einzelne Nachricht (sendeAnPerson):
 *  1. Zieladresse aus Vorname/Nachname + eingestellter Domain bilden
 *     (@vorname.nachname:domain, siehe localpartAusName).
 *  2. Homeserver ermitteln – entweder manuell eingestellt, sonst per
 *     .well-known/matrix/client von der Domain (Matrix-Standardverfahren).
 *  3. Prüfen, ob unter dieser Adresse überhaupt ein Konto existiert (sonst
 *     klarer Fehler statt eines fehlschlagenden/verwaisten Einladungs-
 *     versuchs).
 *  4. Bestehenden Direktnachrichten-Raum wiederverwenden oder neu anlegen.
 *  5. Nachricht senden.
 *
 * Authentifizierung: ein Zugangstoken (kein Passwort wird dauerhaft
 * gespeichert) – entweder direkt eingefügt oder einmalig per anmelden()
 * gegen Benutzername/Passwort eingetauscht, siehe Einstellungen.
 */

function normalisiereNamensteil(teil) {
  return String(teil || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "Anna Sophie", "Müller-Schmidt" -> "anna-sophie.mueller-schmidt" – null, wenn einer der beiden Teile leer bleibt. */
function localpartAusName(vorname, nachname) {
  const v = normalisiereNamensteil(vorname);
  const n = normalisiereNamensteil(nachname);
  if (!v || !n) return null;
  return `${v}.${n}`;
}

/** Reine Adressbildung, ohne Netzwerkzugriff – für die Vorschau in den Einstellungen und zum Testen. */
function matrixIdAusName(vorname, nachname, domain) {
  const localpart = localpartAusName(vorname, nachname);
  const d = String(domain || '').trim();
  if (!localpart || !d) return null;
  return `@${localpart}:${d}`;
}

async function matrixApi(homeserver, path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(`${homeserver}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const fehler = new Error(`Element-Server nicht erreichbar (${homeserver}): ${err.message}`);
    fehler.netzwerkfehler = true;
    throw fehler;
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Antwort war kein JSON (z. B. eine HTML-Fehlerseite eines Proxys) – data bleibt {}.
  }
  if (!res.ok) {
    const fehler = new Error(data?.error || `HTTP ${res.status}`);
    fehler.status = res.status;
    fehler.matrixErrcode = data?.errcode;
    throw fehler;
  }
  return data;
}

/** Homeserver per .well-known/matrix/client ermitteln (Matrix-Standardverfahren) – Fallback: die Domain selbst. */
async function ermittleHomeserver(domain) {
  try {
    const res = await fetch(`https://${domain}/.well-known/matrix/client`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const base = data?.['m.homeserver']?.base_url;
      if (typeof base === 'string' && base) return base.replace(/\/+$/, '');
    }
  } catch {
    // Kein .well-known erreichbar/vorhanden – unten auf die Domain selbst zurückfallen.
  }
  return `https://${domain}`;
}

async function homeserverFuerEinstellungen(einstellungen) {
  const override = String(einstellungen.matrixHomeserver || '').trim();
  if (override) return override.replace(/\/+$/, '');
  const domain = String(einstellungen.matrixDomain || '').trim();
  if (!domain) throw new Error('Keine Domain für Element/Matrix hinterlegt.');
  return ermittleHomeserver(domain);
}

/** Tauscht Benutzername/Passwort einmalig gegen ein Zugangstoken – das Passwort wird von INGA nirgends gespeichert. */
async function anmelden(homeserver, benutzername, passwort) {
  try {
    const data = await matrixApi(homeserver, '/_matrix/client/v3/login', {
      method: 'POST',
      body: { type: 'm.login.password', identifier: { type: 'm.id.user', user: benutzername }, password: passwort },
    });
    return { accessToken: data.access_token, userId: data.user_id };
  } catch (err) {
    if (err.matrixErrcode === 'M_FORBIDDEN') throw new Error('Benutzername oder Passwort falsch.');
    if (err.matrixErrcode === 'M_USER_DEACTIVATED') throw new Error('Dieses Element-Konto ist deaktiviert.');
    throw err;
  }
}

async function werBinIch(homeserver, token) {
  const data = await matrixApi(homeserver, '/_matrix/client/v3/account/whoami', { token });
  return data.user_id;
}

/** true/false, ob unter dieser Matrix-ID ein Konto existiert – andere Fehler (Netzwerk, Server down) werden NICHT als "existiert nicht" verschluckt. */
async function profilExistiert(homeserver, token, userId) {
  try {
    await matrixApi(homeserver, `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`, { token });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

/** Bereits bekannten Direktnachrichten-Raum zu `zielId` finden (m.direct-Kontoattribut) – null, wenn keiner bekannt ist. */
async function direktraumFinden(homeserver, token, eigeneId, zielId) {
  try {
    const data = await matrixApi(homeserver, `/_matrix/client/v3/user/${encodeURIComponent(eigeneId)}/account_data/m.direct`, { token });
    const raeume = data?.[zielId];
    return Array.isArray(raeume) && raeume.length ? raeume[0] : null;
  } catch (err) {
    if (err.status === 404) return null; // noch keine m.direct-Liste vorhanden
    throw err;
  }
}

/** Legt einen neuen Direktnachrichten-Raum an und merkt ihn in m.direct, damit künftige Mahnungen ihn wiederverwenden statt neue Räume anzuhäufen. */
async function direktraumAnlegen(homeserver, token, eigeneId, zielId) {
  const raum = await matrixApi(homeserver, '/_matrix/client/v3/createroom', {
    method: 'POST',
    token,
    body: { invite: [zielId], is_direct: true, preset: 'trusted_private_chat' },
  });
  try {
    const bisherige = await matrixApi(homeserver, `/_matrix/client/v3/user/${encodeURIComponent(eigeneId)}/account_data/m.direct`, { token }).catch(
      (err) => (err.status === 404 ? {} : Promise.reject(err))
    );
    const aktualisiert = { ...bisherige, [zielId]: [...(bisherige[zielId] || []), raum.room_id] };
    await matrixApi(homeserver, `/_matrix/client/v3/user/${encodeURIComponent(eigeneId)}/account_data/m.direct`, {
      method: 'PUT',
      token,
      body: aktualisiert,
    });
  } catch {
    // Nicht kritisch – die Nachricht geht trotzdem raus, nur die
    // Wiederverwendung des Raums beim nächsten Mal entfällt dann.
  }
  return raum.room_id;
}

async function nachrichtSenden(homeserver, token, roomId, text) {
  const txnId = `inga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await matrixApi(homeserver, `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, {
    method: 'PUT',
    token,
    body: { msgtype: 'm.text', body: text },
  });
}

/** Orchestriert den vollen Ablauf für eine Mahnung an eine Person – siehe Modulkopf. */
async function sendeAnPerson(einstellungen, { vorname, nachname, text }) {
  if (!einstellungen.matrixAktiv) throw new Error('Element-Versand ist in den Einstellungen nicht aktiviert.');
  const token = String(einstellungen.matrixZugangstoken || '').trim();
  if (!token) throw new Error('Kein Element-Zugangstoken hinterlegt – bitte in den Einstellungen anmelden.');
  const eigeneId = String(einstellungen.matrixVersenderId || '').trim();
  if (!eigeneId) throw new Error('Kein Versender-Konto ermittelt – bitte in den Einstellungen erneut anmelden.');

  const domain = String(einstellungen.matrixDomain || '').trim();
  const zielId = matrixIdAusName(vorname, nachname, domain);
  if (!zielId) throw new Error('Kein gültiger Name/keine Domain für die Adressbildung vorhanden.');

  const homeserver = await homeserverFuerEinstellungen(einstellungen);
  const existiert = await profilExistiert(homeserver, token, zielId);
  if (!existiert) {
    const fehler = new Error(`Kein Element-Konto „${zielId}“ gefunden.`);
    fehler.zielId = zielId;
    throw fehler;
  }
  let roomId = await direktraumFinden(homeserver, token, eigeneId, zielId);
  if (!roomId) roomId = await direktraumAnlegen(homeserver, token, eigeneId, zielId);
  await nachrichtSenden(homeserver, token, roomId, text);
  return { zielId };
}

module.exports = {
  normalisiereNamensteil,
  localpartAusName,
  matrixIdAusName,
  ermittleHomeserver,
  homeserverFuerEinstellungen,
  anmelden,
  werBinIch,
  profilExistiert,
  direktraumFinden,
  direktraumAnlegen,
  nachrichtSenden,
  sendeAnPerson,
};
