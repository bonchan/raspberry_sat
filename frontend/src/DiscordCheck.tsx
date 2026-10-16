import { useState } from 'react'
import { api, ApiError, discordInvite, type Discord, type DiscordSent } from './api'
import { useT } from './i18n'

/** Under Settings → Discord: add the bot to a server, and post a test message with the settings on the page. */
export default function DiscordCheck({ discord }: { discord: Discord }) {
  const t = useT()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<DiscordSent | null>(null)
  const [error, setError] = useState('')
  const appId = discord.application_id.trim()

  async function test() {
    setSending(true); setError(''); setSent(null)
    try {
      setSent(await api.testDiscord(discord))
    } catch (e) {
      setError(e instanceof ApiError && e.details.length ? e.details.join(' ') : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="receiver-test">
      <div className="row">
        {/^\d+$/.test(appId)
          ? <a className="button" href={discordInvite(appId)} target="_blank" rel="noreferrer">{t('settings.invite')}</a>
          : <button disabled>{t('settings.invite')}</button>}
        <span className="hint">{t('settings.inviteHint')}</span>
      </div>
      <div className="row">
        <button disabled={sending || !discord.bot_token || !discord.channel_id} onClick={test}>
          {sending ? t('settings.discordTesting') : t('settings.discordTest')}
        </button>
        <span className="hint">{t('settings.discordTestHint')}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {sent && (
        <p className="ok">
          {t('settings.discordTestOk', { channel: sent.channel ?? '?' })}{' '}
          <a href={sent.url} target="_blank" rel="noreferrer">{t('detail.discordOpen')}</a>
        </p>
      )}    </div>
  )
}
