/** A hub: one node joined to the others (where passes from several stations meet), in the current text colour.
    Marks links to a pass on a destination such as the raspberry-sat hub, as DiscordIcon does for Discord. */
export default function HubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="hub-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 9.5V4.5M14.2 13.3l4.3 2.5M9.8 13.3l-4.3 2.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="12" cy="3" r="2" />
      <circle cx="19.8" cy="16.5" r="2" />
      <circle cx="4.2" cy="16.5" r="2" />
    </svg>
  )
}
