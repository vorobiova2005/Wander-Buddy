import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { resetProgress } from '../lib/progress'
import { Button } from './ui'

/**
 * The last line of defence: an error while drawing a screen shows a way out instead of a blank page. The likely
 * culprit that a reload does not cure is the stored progress, so starting it over is offered too.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Wander Buddy crashed:', error, info.componentStack)
  }

  render() {
    return this.state.failed ? <Crashed onReset={() => this.setState({ failed: false })} /> : this.props.children
  }
}

function Crashed({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10" role="alert">
      <h1 className="text-[24px] leading-8 font-bold">{t('app.error.title')}</h1>
      <p>{t('app.error.text')}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => window.location.reload()}>{t('app.error.reload')}</Button>
        <Button
          variant="secondary"
          onClick={() => {
            resetProgress()
            window.history.replaceState(null, '', '/')
            onReset()
          }}
        >
          {t('app.error.reset')}
        </Button>
      </div>
    </main>
  )
}
