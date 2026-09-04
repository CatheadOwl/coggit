import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconNewChatOutline16,
  IconRefreshOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

import type { CoggitInitLocaleKey } from './locales.js'
import { resolveWorkspacePath } from './workspace-resolve.js'
import css from './CoggitInitTab.module.css'

export interface CoggitInitStatus {
  initialized: boolean
  workspace: string
  configPath?: string
}

export interface CoggitSourceCandidate {
  name: string
}

export interface CoggitInitRequest {
  /** Current workspace directory the host should initialize; omitted when
   * the browser has no workspace selected yet. */
  workspace?: string
  sourceRoot?: string
  cognitionRoot?: string
}

export interface CoggitInitResult extends CoggitInitStatus {
  sourceRoot: string
  cognitionRoot: string
}

export interface CoggitInitTabInjected {
  status: (workspace: string | undefined) => Promise<CoggitInitStatus>
  sourceCandidates: (workspace: string | undefined) => Promise<CoggitSourceCandidate[]>
  init: (request: CoggitInitRequest) => Promise<CoggitInitResult>
}

export type CoggitInitTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.coggit'>
  & InjectFace<CoggitInitTabInjected>

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; init: CoggitInitStatus; candidates: readonly CoggitSourceCandidate[] }
  | { status: 'done'; result: CoggitInitResult }

export function CoggitInitTab({ t, useSessions, useWorkspaces, status, sourceCandidates, init }: CoggitInitTabProps) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [sourceRoot, setSourceRoot] = useState('src')
  const [cognitionRoot, setCognitionRoot] = useState('src_cognition')
  const [submitting, setSubmitting] = useState(false)
  const [reload, setReload] = useState(0)

  // Act on the workspace the user is looking at: the workspace owning the
  // currently selected session first, then the most recently active one
  // (mirrors UiWorkspaceService.startSession target resolution), then
  // undefined — the wire omits the workspace and the server resolves its cwd.
  const sessions = useSessions(listState => listState)
  const workspacePath = useWorkspaces(workspaceState => resolveWorkspacePath(workspaceState, sessions))

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.all([status(workspacePath), sourceCandidates(workspacePath)]).then(
      ([initStatus, candidates]) => {
        if (!current) return
        setState({ status: 'ready', init: initStatus, candidates })
      },
      (error: unknown) => {
        if (!current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { current = false }
  }, [reload, workspacePath, sourceCandidates, status])

  const defaultCognitionRoot = useMemo(() => `${sourceRoot.trim() || 'src'}_cognition`, [sourceRoot])
  const effectiveCognitionRoot = cognitionRoot.trim() === '' ? defaultCognitionRoot : cognitionRoot
  const canSubmit = state.status === 'ready' && !state.init.initialized && sourceRoot.trim() !== '' && effectiveCognitionRoot.trim() !== ''

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    try {
      const result = await init({
        workspace: workspacePath,
        sourceRoot: sourceRoot.trim(),
        cognitionRoot: effectiveCognitionRoot.trim(),
      })
      setState({ status: 'done', result })
    } catch (error: unknown) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setSubmitting(false)
    }
  }

  if (state.status === 'loading') {
    return <p className={css.status}>{t('loading')}</p>
  }

  if (state.status === 'error') {
    return (
      <div className={css.failure}>
        <p role="alert">{t('error')}</p>
        <code>{state.message}</code>
        <Button variant="outline" size="sm" icon={<IconRefreshOutline16 />} onClick={() => { setReload(value => value + 1) }}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  if (state.status === 'done') {
    return (
      <section className={css.section}>
        <div className={css.resultIcon} aria-hidden="true"><IconCheckOutline16 /></div>
        <div className={css.copy}>
          <h3>{t('successTitle')}</h3>
          <p>{t('successBody')}</p>
          <dl className={css.meta}>
            <div><dt>{t('workspace')}</dt><dd>{state.result.workspace}</dd></div>
            <div><dt>{t('sourceRoot')}</dt><dd>{state.result.sourceRoot}</dd></div>
            <div><dt>{t('cognitionRoot')}</dt><dd>{state.result.cognitionRoot}</dd></div>
          </dl>
        </div>
      </section>
    )
  }

  if (state.init.initialized) {
    return (
      <section className={css.section}>
        <div className={css.resultIcon} aria-hidden="true"><IconCheckOutline16 /></div>
        <div className={css.copy}>
          <h3>{t('readyTitle')}</h3>
          <p>{t('readyBody')}</p>
          <dl className={css.meta}>
            <div><dt>{t('workspace')}</dt><dd>{state.init.workspace}</dd></div>
          </dl>
        </div>
      </section>
    )
  }

  return (
    <form className={css.form} onSubmit={(event) => { void submit(event) }}>
      <div className={css.heading}>
        <h3>{t('title')}</h3>
        <Button type="button" variant="ghost" size="sm" icon={<IconRefreshOutline16 />} onClick={() => { setReload(value => value + 1) }}>
          {t('refresh')}
        </Button>
      </div>
      <dl className={css.meta}>
        <div><dt>{t('workspace')}</dt><dd>{state.init.workspace}</dd></div>
      </dl>
      <label className={css.field}>
        <span>{t('sourceRoot')}</span>
        <Input value={sourceRoot} placeholder={t('sourcePlaceholder')} onChange={event => { setSourceRoot(event.currentTarget.value) }} />
      </label>
      <label className={css.field}>
        <span>{t('cognitionRoot')}</span>
        <Input value={cognitionRoot} placeholder={defaultCognitionRoot} onChange={event => { setCognitionRoot(event.currentTarget.value) }} />
      </label>
      {state.candidates.length > 0 ? (
        <div className={css.candidates} aria-label={t('candidateLabel')}>
          {state.candidates.slice(0, 8).map(candidate => (
            <button
              key={candidate.name}
              type="button"
              onClick={() => {
                setSourceRoot(candidate.name)
                setCognitionRoot(`${candidate.name}_cognition`)
              }}
            >
              {candidate.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className={css.actions}>
        <Button
          variant="primary"
          type="submit"
          disabled={!canSubmit || submitting}
          icon={<IconNewChatOutline16 />}
        >
          {t(submitting ? 'initializing' : 'initialize')}
        </Button>
      </div>
    </form>
  )
}
