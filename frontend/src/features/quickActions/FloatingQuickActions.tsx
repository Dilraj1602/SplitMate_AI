import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { List, Plus, ReceiptText, UsersRound, WalletCards } from 'lucide-react'
import { useQuickActionPreferences } from './preferences'
import { getRadialOffsets } from './radialLayout'

const actions = [
  { label: 'Create Group', to: '/app/groups/new', icon: UsersRound },
  { label: 'Add Expense', to: '/app/groups', icon: ReceiptText },
  { label: 'Settle Up', to: '/app/settlements', icon: WalletCards },
  { label: 'All Expenses', to: '/app/expenses', icon: List },
]

export function FloatingQuickActions() {
  const { preferences } = useQuickActionPreferences()
  const [open, setOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth)
  const rootRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([])
  const location = useLocation()
  const motionClass = !preferences.animate || preferences.reduceMotion ? ' quick-actions-no-animation' : ''
  const fabSize = preferences.size === 'small' ? 48 : preferences.size === 'large' ? (viewportWidth <= 639 ? 62 : 66) : (viewportWidth <= 639 ? 54 : 58)
  const actionSize = preferences.size === 'small' ? 40 : preferences.size === 'large' ? 48 : 44
  const offsets = getRadialOffsets(preferences.position, viewportWidth)

  useEffect(() => { setOpen(false) }, [location.pathname, location.search])
  useEffect(() => {
    function resize() { setViewportWidth(window.innerWidth) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { setOpen(false); fabRef.current?.focus() }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        const index = itemRefs.current.findIndex(item => item === document.activeElement)
        if (index >= 0) { event.preventDefault(); itemRefs.current[(index + 1) % actions.length]?.focus() }
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        const index = itemRefs.current.findIndex(item => item === document.activeElement)
        if (index >= 0) { event.preventDefault(); itemRefs.current[(index + actions.length - 1) % actions.length]?.focus() }
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  if (!preferences.visible) return null
  return <div ref={rootRef} className={`floating-quick-actions quick-actions-${preferences.position} quick-actions-${preferences.size}${motionClass}`}>
    <div id="quick-action-menu" className="quick-action-items" role="menu" aria-label="Quick actions" aria-hidden={!open}>
      {actions.map(({ label, to, icon: Icon }, index) => {
        const { x, y } = offsets[index]
        const edge = (fabSize - actionSize) / 2
        const radius = viewportWidth <= 639 ? 76 : viewportWidth <= 1023 ? 85 : 95
        const labelX = index === 3
          ? (preferences.position === 'right' ? (viewportWidth <= 639 ? -15 : -10) : (viewportWidth <= 639 ? 15 : 10))
          : x / radius * 52
        const labelY = index === 3 ? -(y + (viewportWidth <= 639 ? 92 : 70)) : -y / radius * 52
        return <Link
        key={label}
        ref={node => { itemRefs.current[index] = node }}
        to={to}
        role="menuitem"
        tabIndex={open ? 0 : -1}
        className="quick-action-item"
        title={label}
        style={{
          left: preferences.position === 'left' ? `${edge + x}px` : 'auto',
          right: preferences.position === 'right' ? `${edge - x}px` : 'auto',
          bottom: `${edge + y}px`,
          width: `${actionSize}px`, height: `${actionSize}px`,
          '--home-x': `${-x}px`,
          '--home-y': `${y}px`,
          '--label-x': `${labelX}px`,
          '--label-y': `${labelY}px`,
          transitionDelay: open && !preferences.reduceMotion && preferences.animate ? `${index * 30}ms` : '0ms',
        } as CSSProperties}
        onClick={() => setOpen(false)}
      ><span className="quick-action-icon"><Icon size={19} aria-hidden="true" /><span className="quick-action-label">{label}</span></span></Link>
      })}
    </div>
    <button
      ref={fabRef}
      type="button"
      className={`quick-action-fab${open ? ' quick-action-fab-open' : ''}`}
      aria-label={open ? 'Close quick actions' : 'Open quick actions'}
      aria-expanded={open}
      aria-controls="quick-action-menu"
      title={open ? 'Close quick actions' : 'Quick actions'}
      onClick={() => setOpen(value => !value)}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => { if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && !open) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => itemRefs.current[0]?.focus()) } }}
      ><Plus size={27} strokeWidth={2.3} aria-hidden="true" /><span className="sr-only">Quick actions</span></button>
  </div>
}

export function QuickActionPreferencesPanel() {
  const { preferences, update } = useQuickActionPreferences()
  return <section className="panel quick-action-preferences" aria-labelledby="quick-actions-preferences-title">
    <div><h2 id="quick-actions-preferences-title">Floating quick actions</h2><p className="muted-copy">Choose where the global action button appears and how it moves.</p></div>
    <div className="form-grid-two">
      <fieldset className="participant-fieldset"><legend>Position</legend>
        <label className="check-row"><input type="radio" name="quick-action-position" checked={preferences.position === 'right'} onChange={() => update({ position: 'right' })} />Bottom Right</label>
        <label className="check-row"><input type="radio" name="quick-action-position" checked={preferences.position === 'left'} onChange={() => update({ position: 'left' })} />Bottom Left</label>
      </fieldset>
      <div className="field-wrap"><label htmlFor="quick-action-size">Button size</label><select id="quick-action-size" value={preferences.size} onChange={event => update({ size: event.target.value as typeof preferences.size })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div>
    </div>
    <label className="check-row"><input type="checkbox" checked={preferences.visible} onChange={event => update({ visible: event.target.checked })} />Show floating quick actions</label>
    <label className="check-row"><input type="checkbox" checked={preferences.animate} onChange={event => update({ animate: event.target.checked })} />Enable radial animation</label>
    <label className="check-row"><input type="checkbox" checked={preferences.reduceMotion} onChange={event => update({ reduceMotion: event.target.checked })} />Reduce animation</label>
    <small className="field-hint">These settings are saved in this browser. Your device’s reduced-motion setting is also respected.</small>
  </section>
}
