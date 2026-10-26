// The hub's texts in English and Spanish, worded as on the Pi where they say the same (frontend/src/i18n.ts).
// The language is this browser's choice (the user menu, or the sign-in page), at first the browser's own.
// `es` must have every key `en` has: TypeScript fails the build otherwise.

import { createContext, useCallback, useContext } from 'react'

export type Lang = 'en' | 'es'

export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
]

// dates and times follow the language, always on a 24-hour clock (as on the Pi)
const LOCALES: Record<Lang, string> = { en: 'en-GB', es: 'es-AR' }

const en = {
  'common.loading': 'Loading…',
  'common.close': 'Close',
  'common.allPasses': 'All passes',
  'app.notAnswering': 'The hub is not answering: {error}',
  'app.notFound': 'Nothing here.',

  'signin.what': 'Satellite images from the stations.',
  'signin.google': 'Sign in with Google',
  'signin.cancelled': 'Sign-in was cancelled.',
  'signin.failed': 'Sign-in failed: {error}',
  'signin.privacy': 'Privacy',
  'waiting.signedInAs': 'Signed in as',
  'waiting.ask': 'An admin has to let you in. Ask them, then reload this page.',

  'nav.passes': 'Passes',
  'nav.receivers': 'Receivers',
  'nav.users': 'Users',
  'menu.open': 'Account and language',
  'menu.language': 'Language',
  'menu.signOut': 'Sign out',

  'day.today': 'Today',
  'day.yesterday': 'Yesterday',
  'ago.never': 'never',
  'ago.now': 'just now',
  'ago.min': '{n} min ago',
  'ago.h': '{n} h ago',
  'ago.d': '{n} d ago',

  'passes.title': 'Passes',
  'passes.grid': 'Grid',
  'passes.list': 'List',
  'passes.globe': 'Globe',
  'passes.allReceivers': 'All receivers',
  'passes.allStations': 'All stations',
  'passes.none': 'No passes yet.',
  'passes.noneAdmin': 'Add a receiver on the Receivers page, then paste its URL and token into the Pi\'s settings.',
  'passes.older': 'Older passes',
  'passes.noImages': 'No images',
  'passes.maxEl': 'max {el}°',
  'passes.snr': 'SNR {snr} dB',
  'passes.received': '{p} received',
  'passes.oneImage': '1 image',
  'passes.images': '{n} images',
  'globe.none': 'None of these passes can be placed on the globe. A Pi sends where its images lie with each pass once it has the update with the globe; passes it sent before go again by themselves.',
  'globe.cantPlace': 'can\'t be placed',
  'globe.loading': 'Loading the globe…',
  'globe.failed': 'The globe could not load: {error}',

  'detail.time': 'Time',
  'detail.maxEl': 'Highest elevation',
  'detail.at': 'at {time}',
  'detail.overSky': 'Above the horizon',
  'detail.signal': 'Signal (SNR)',
  'detail.signalValue': 'peak {peak} dB, average {mean} dB',
  'detail.locked': 'Locked',
  'detail.lockedValue': '{p} of {d} recorded',
  'detail.received': 'Received',
  'detail.receivedValue': '{p} of the main image',
  'detail.firstSync': 'First sync',
  'detail.lastSync': 'Last sync',
  'detail.syncAt': '{el}° elevation at {time}, {dir}',
  'detail.station': 'Station',
  'detail.receiver': 'Receiver',
  'detail.uploaded': 'Uploaded',
  'detail.noImages': 'No images',
  'detail.delete': 'Delete pass',
  'detail.confirmDelete': 'Delete this pass of {receiver} from the hub? The Pi keeps its own copy.',
  'detail.signalChart': 'Signal over the pass',

  'chart.snr': 'SNR (0–{max} dB)',
  'chart.el': 'elevation (0–90°)',
  'chart.sync': 'frames sync',
  'chart.noSync': 'no sync',
  'sky.label': 'The pass across the sky',
  'sky.rises': 'rises',
  'sky.sets': 'sets',
  'sky.n': 'N',
  'sky.e': 'E',
  'sky.s': 'S',
  'sky.w': 'W',

  'receivers.title': 'Receivers',
  'receivers.hint': 'One per Pi. Its stations are the places set in the Pi\'s Settings → Stations; each pass says which one received it.',
  'receivers.none': 'No receivers yet: add one below.',
  'receivers.receiver': 'Receiver',
  'receivers.stations': 'Stations',
  'receivers.passes': 'Passes',
  'receivers.lastPass': 'Last pass',
  'receivers.lastSeen': 'Last heard from',
  'receivers.added': 'Added',
  'receivers.revoked': 'revoked',
  'receivers.noStations': 'none yet',
  'receivers.rename': 'Rename',
  'receivers.newToken': 'New token',
  'receivers.revoke': 'Revoke',
  'receivers.delete': 'Delete',
  'receivers.working': 'Working…',
  'receivers.renamePrompt': 'New name for {name}:',
  'receivers.confirmToken': 'New token for {name}? Its current token stops working at once; paste the new one into the Pi.',
  'receivers.confirmRevoke': 'Revoke {name}? It can no longer upload; its passes stay. "New token" lets it in again.',
  'receivers.confirmDelete': 'Delete {name} and its {n} passes from the hub? This cannot be undone. The Pi keeps its own copies.',
  'receivers.add': 'Add a receiver',
  'receivers.name': 'Name',
  'receivers.namePlaceholder': 'Roof Pi',
  'receivers.addButton': 'Add',
  'receivers.addHint': 'The hub gives it an id of its own and a URL and token to paste into the Pi\'s settings. The name can be changed later.',
  'link.title': '{name}: for the Pi\'s settings',
  'link.where': 'On the Pi: Settings → Destinations, add one (or open the existing one) and paste these two.',
  'link.copy': 'Copy',
  'link.copied': 'Copied',
  'link.once': 'The token is shown only now. Lost it? "New token" makes another (the old one stops working).',
  'link.done': 'Done',

  'users.title': 'Users',
  'users.hint': 'Anyone with a Google account can sign in; they wait as pending until you give them a role. To keep someone out, leave them pending.',
  'users.user': 'User',
  'users.role': 'Role',
  'users.lastLogin': 'Last sign-in',
  'users.firstLogin': 'First sign-in',
  'users.you': '(you)',
  'users.remove': 'Remove',
  'users.confirmRemove': 'Remove {email}? They are signed out; if they sign in again they wait as pending.',
  'role.admin': 'admin',
  'role.viewer': 'viewer',
  'role.pending': 'pending',
  'roleText.admin': 'admin: sees everything, manages receivers and users',
  'roleText.viewer': 'viewer: sees the passes',
  'roleText.pending': 'pending: sees nothing until you choose',
}

export type Key = keyof typeof en

const es: Record<Key, string> = {
  'common.loading': 'Cargando…',
  'common.close': 'Cerrar',
  'common.allPasses': 'Todas las pasadas',
  'app.notAnswering': 'El hub no responde: {error}',
  'app.notFound': 'No hay nada acá.',

  'signin.what': 'Imágenes satelitales de las estaciones.',
  'signin.google': 'Entrar con Google',
  'signin.cancelled': 'Se canceló el ingreso.',
  'signin.failed': 'No se pudo entrar: {error}',
  'signin.privacy': 'Privacidad',
  'waiting.signedInAs': 'Entraste como',
  'waiting.ask': 'Un administrador tiene que darte acceso. Pedíselo y después recargá esta página.',

  'nav.passes': 'Pasadas',
  'nav.receivers': 'Receptores',
  'nav.users': 'Usuarios',
  'menu.open': 'Cuenta e idioma',
  'menu.language': 'Idioma',
  'menu.signOut': 'Salir',

  'day.today': 'Hoy',
  'day.yesterday': 'Ayer',
  'ago.never': 'nunca',
  'ago.now': 'recién',
  'ago.min': 'hace {n} min',
  'ago.h': 'hace {n} h',
  'ago.d': 'hace {n} d',

  'passes.title': 'Pasadas',
  'passes.grid': 'Cuadrícula',
  'passes.list': 'Lista',
  'passes.globe': 'Globo',
  'passes.allReceivers': 'Todos los receptores',
  'passes.allStations': 'Todas las estaciones',
  'passes.none': 'Todavía no hay pasadas.',
  'passes.noneAdmin': 'Agregá un receptor en la página Receptores y pegá su URL y su token en la configuración de la Pi.',
  'passes.older': 'Pasadas anteriores',
  'passes.noImages': 'Sin imágenes',
  'passes.maxEl': 'máx {el}°',
  'passes.snr': 'SNR {snr} dB',
  'passes.received': '{p} recibido',
  'passes.oneImage': '1 imagen',
  'passes.images': '{n} imágenes',
  'globe.none': 'Ninguna de estas pasadas se puede ubicar en el globo. Una Pi envía dónde caen sus imágenes con cada pasada cuando tiene la actualización con el globo; las que envió antes se vuelven a enviar solas.',
  'globe.cantPlace': 'no se puede ubicar',
  'globe.loading': 'Cargando el globo…',
  'globe.failed': 'No se pudo cargar el globo: {error}',

  'detail.time': 'Hora',
  'detail.maxEl': 'Elevación máxima',
  'detail.at': 'a las {time}',
  'detail.overSky': 'Sobre el horizonte',
  'detail.signal': 'Señal (SNR)',
  'detail.signalValue': 'pico {peak} dB, promedio {mean} dB',
  'detail.locked': 'Sincronía',
  'detail.lockedValue': '{p} de {d} grabados',
  'detail.received': 'Recibido',
  'detail.receivedValue': '{p} de la imagen principal',
  'detail.firstSync': 'Primera sincronía',
  'detail.lastSync': 'Última sincronía',
  'detail.syncAt': '{el}° de elevación a las {time}, {dir}',
  'detail.station': 'Estación',
  'detail.receiver': 'Receptor',
  'detail.uploaded': 'Subida',
  'detail.noImages': 'Sin imágenes',
  'detail.delete': 'Borrar pasada',
  'detail.confirmDelete': '¿Borrar del hub esta pasada de {receiver}? La Pi conserva su propia copia.',
  'detail.signalChart': 'Señal durante la pasada',

  'chart.snr': 'SNR (0–{max} dB)',
  'chart.el': 'elevación (0–90°)',
  'chart.sync': 'tramas sincronizando',
  'chart.noSync': 'sin sincronía',
  'sky.label': 'La pasada en el cielo',
  'sky.rises': 'sale',
  'sky.sets': 'se pone',
  'sky.n': 'N',
  'sky.e': 'E',
  'sky.s': 'S',
  'sky.w': 'O',

  'receivers.title': 'Receptores',
  'receivers.hint': 'Uno por Pi. Sus estaciones son los lugares configurados en Configuración → Estaciones de la Pi; cada pasada dice cuál la recibió.',
  'receivers.none': 'Todavía no hay receptores: agregá uno abajo.',
  'receivers.receiver': 'Receptor',
  'receivers.stations': 'Estaciones',
  'receivers.passes': 'Pasadas',
  'receivers.lastPass': 'Última pasada',
  'receivers.lastSeen': 'Última conexión',
  'receivers.added': 'Agregado',
  'receivers.revoked': 'revocado',
  'receivers.noStations': 'ninguna todavía',
  'receivers.rename': 'Renombrar',
  'receivers.newToken': 'Token nuevo',
  'receivers.revoke': 'Revocar',
  'receivers.delete': 'Borrar',
  'receivers.working': 'Trabajando…',
  'receivers.renamePrompt': 'Nombre nuevo para {name}:',
  'receivers.confirmToken': '¿Token nuevo para {name}? El actual deja de funcionar enseguida; pegá el nuevo en la Pi.',
  'receivers.confirmRevoke': '¿Revocar {name}? Ya no puede subir pasadas; las que subió quedan. "Token nuevo" lo vuelve a habilitar.',
  'receivers.confirmDelete': '¿Borrar {name} y sus {n} pasadas del hub? No se puede deshacer. La Pi conserva sus propias copias.',
  'receivers.add': 'Agregar un receptor',
  'receivers.name': 'Nombre',
  'receivers.namePlaceholder': 'Pi del techo',
  'receivers.addButton': 'Agregar',
  'receivers.addHint': 'El hub le da un id propio, y una URL y un token para pegar en la configuración de la Pi. El nombre se puede cambiar después.',
  'link.title': '{name}: para la configuración de la Pi',
  'link.where': 'En la Pi: Configuración → Destinos, agregá uno (o abrí el que ya existe) y pegá estos dos.',
  'link.copy': 'Copiar',
  'link.copied': 'Copiado',
  'link.once': 'El token se muestra solo ahora. ¿Lo perdiste? "Token nuevo" crea otro (el anterior deja de funcionar).',
  'link.done': 'Listo',

  'users.title': 'Usuarios',
  'users.hint': 'Cualquiera con una cuenta de Google puede entrar; queda como pendiente hasta que le des un rol. Para dejar a alguien afuera, dejalo pendiente.',
  'users.user': 'Usuario',
  'users.role': 'Rol',
  'users.lastLogin': 'Último ingreso',
  'users.firstLogin': 'Primer ingreso',
  'users.you': '(vos)',
  'users.remove': 'Quitar',
  'users.confirmRemove': '¿Quitar a {email}? Se le cierra la sesión; si vuelve a entrar, queda como pendiente.',
  'role.admin': 'admin',
  'role.viewer': 'espectador',
  'role.pending': 'pendiente',
  'roleText.admin': 'admin: ve todo, administra receptores y usuarios',
  'roleText.viewer': 'espectador: ve las pasadas',
  'roleText.pending': 'pendiente: no ve nada hasta que elijas',
}

const TEXTS: Record<Lang, Record<Key, string>> = { en, es }
const STORED = 'raspberry-sat-hub-language'

/** this browser's choice, else the browser's own language */
export function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(STORED)
    if (saved === 'en' || saved === 'es') return saved
  } catch { /* private mode */ }
  return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function storeLanguage(lang: Lang): void {
  try { localStorage.setItem(STORED, lang) } catch { /* private mode */ }
}

// the active language for code outside React components (the dates in format.ts)
let current: Lang = 'en'
export const setCurrentLanguage = (lang: Lang) => { current = lang }
export const currentLanguage = () => current
export const locale = () => LOCALES[current]

export type Vars = Record<string, string | number>

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const text = TEXTS[lang][key]
  return vars ? text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : text
}

/** outside components: in the current language */
export const tr = (key: Key, vars?: Vars) => translate(current, key, vars)

export const LanguageContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({
  lang: 'en', setLang: () => {},
})

export const useLanguage = () => useContext(LanguageContext)

/** t('passes.images', { n: 3 }) in the current language */
export function useT() {
  const { lang } = useContext(LanguageContext)
  return useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang])
}
