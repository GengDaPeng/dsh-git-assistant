/** Browser plugin entry point registering the sidebar icon, main management panel, and Plugin Manager config view. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openKnownSession, SessionNavigationError } from '../navigation.ts'
import { App } from './app.tsx'
import { PluginConfig, usePageForm } from './deployment.tsx'
import { en, zh } from './locales.ts'
import type { T } from './text.ts'

type ClientContext = Context & { sessions: ISessions }
const NS = 'dshSuperagent'
const PANEL_ID = 'dsh-superagent' as MainPanelId
const CHAT_PANEL_ID = 'dsh-superagent-chat' as MainPanelId
const ENTRY = 'dsh-superagent'

function HammerIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 3.5h9l3.5 1.75v2.5L15 9.5H6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" /><path d="M10 9.5v10.25a1.75 1.75 0 0 0 3.5 0V9.5" /><path d="M10 15.5h3.5" />
  </svg>
}

/** Sidebar icon of the chat-first entry: click it to land in the superagent's main Session. */
function ChatIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4.5 5.5h15v9.5h-8.6L7 18.5V15H4.5z" /><path d="M8 9h8M8 12h5" />
  </svg>
}

/**
 * Chat-first entry: resolve the plugin's main Session through its management API, then hand the user to DSH's standard
 * Conversation. It never renders a chat of its own — the custom panel cannot host one.
 */
function ChatEntry({ ctx, t }: { ctx: ClientContext; t: T }) {
  const [message, setMessage] = useState(() => t('chatOpening'))
  useEffect(() => {
    const request = new AbortController()
    void (async () => {
      try {
        const response = await fetch('/orchestrator/api/state', { headers: { 'x-orchestrator-request': '1' }, signal: request.signal })
        if (!response.ok) throw new Error(`state ${response.status}`)
        const state = await response.json() as { masterId?: string }
        if (!state.masterId) throw new Error('masterId missing')
        await openKnownSession(ctx.sessions, state.masterId as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
      } catch (error) {
        if (request.signal.aborted) return
        const detail = error instanceof SessionNavigationError ? t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed')
          : error instanceof Error ? error.message : String(error)
        setMessage(t('chatUnavailable', { detail }))
      }
    })()
    return () => request.abort()
  }, [ctx, t])
  return <div className="dt-page"><div className="dt-column">
    <p className="dt-hint">{message}</p>
    <p><button type="button" className="dt-open" onClick={() => { ctx.layout.selectPanel(PANEL_ID) }}>{t('openPanel')}</button></p>
  </div></div>
}

/** One shared lookup of the plugin's main Session id, used by the in-chat shortcut to the management panel. */
let masterIdPromise: Promise<string | undefined> | undefined
const loadMasterId = (): Promise<string | undefined> => masterIdPromise ??= fetch('/orchestrator/api/state', { headers: { 'x-orchestrator-request': '1' } })
  .then(response => response.ok ? response.json() as Promise<{ masterId?: string }> : Promise.reject(new Error(`state ${response.status}`)))
  .then(state => state.masterId)
  .catch(() => undefined)

/**
 * Shortcut into the management panel, rendered in the Chat header of the plugin's main Session only: the panel is a setting
 * page, so it does not get a sidebar entry of its own.
 */
function PanelShortcut({ ctx, t, sessionId }: { ctx: ClientContext; t: T; sessionId: SessionId }) {
  const [master, setMaster] = useState<string | undefined>()
  useEffect(() => { if (master === undefined) void loadMasterId().then(setMaster) }, [master])
  if (!master || sessionId !== master) return null
  return <button type="button" aria-label={t('openPanel')} title={t('openPanel')} onClick={() => { ctx.layout.selectPanel(PANEL_ID) }}
    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 0,
      border: 'none', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', opacity: 0.72 }}>
    <HammerIcon size={16} />
  </button>
}

/** Mounted panel wrapper; cancels any pending Session navigation when a new one starts or the panel unmounts. */
function Mounted({ ctx, t }: { ctx: ClientContext; t: T }) {
  const pending = useRef<AbortController>(undefined)
  useEffect(() => () => { pending.current?.abort() }, [])
  const openSession = useCallback(async (id: string) => {
    pending.current?.abort()
    const request = new AbortController(); pending.current = request
    try {
      await openKnownSession(ctx.sessions, id as SessionId, target => { ctx.uiWorkspace.openSession(target) }, request.signal)
    } catch (error) {
      if (error instanceof SessionNavigationError) throw new Error(t(error.code === 'not-ready' ? 'sessionListNotReady' : 'sessionNotListed'))
      throw error
    }
  }, [ctx, t])
  const form = usePageForm(ctx.get('configForms')?.get<Record<string, unknown>>(ENTRY))
  return <App t={t} openSession={openSession} deploymentForm={form} />
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']
/** Registers the chat-first sidebar entry, the management panel behind it, the in-chat panel shortcut, and the Plugin Manager config view. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) },
    (props: { t: T }) => <Mounted ctx={ctx} t={props.t} />))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: CHAT_PANEL_ID, locale: NS, inject: () => ({}) },
    (props: { t: T }) => <ChatEntry ctx={ctx} t={props.t} />))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: CHAT_PANEL_ID, order: 11, label: () => t('chatPanel'), locale: NS }, ChatIcon))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'dsh-superagent-panel', order: -5, label: () => t('openPanel'), locale: NS },
    (props: { sessionId: SessionId }) => <PanelShortcut ctx={ctx} t={t} sessionId={props.sessionId} />))
  ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: `${ENTRY}#${ENTRY}`, locale: NS },
    (props: PluginConfigViewProps & { t: T }) => <PluginConfig t={props.t} view={props.view} form={props.form} />))
}
