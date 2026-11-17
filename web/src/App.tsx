import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ServerState = 'checking' | 'ok' | 'down'

export default function App() {
  const { t } = useTranslation()
  const [server, setServer] = useState<ServerState>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((body: { ok?: boolean }) => setServer(body.ok ? 'ok' : 'down'))
      .catch(() => setServer('down'))
  }, [])

  const dot = { checking: 'bg-amber-400', ok: 'bg-emerald-500', down: 'bg-rose-500' }[server]

  return (
    <main className="min-h-dvh bg-teal-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-md space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-teal-800">{t('app.title')}</h1>
          <p className="text-lg">{t('app.tagline')}</p>
        </header>
        <p className="rounded-2xl bg-white p-4 shadow-sm">{t('app.comingSoon')}</p>
        <p className="flex items-center gap-2 text-sm" role="status">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
          {t(`app.server.${server}`)}
        </p>
      </div>
    </main>
  )
}
