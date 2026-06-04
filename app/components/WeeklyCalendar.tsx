'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Shift, UserProfile } from '@/lib/types'

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const DAY_LABELS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const HALVES: ('AM' | 'PM')[] = ['AM', 'PM']

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getWeekDates(offset: number): Date[] {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function formatWeekRange(dates: Date[]): string {
  const start = dates[0].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  const end = dates[6].toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${start} – ${end}`
}

function formatDayFull(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function isToday(date: Date): boolean {
  const t = new Date()
  return date.getFullYear() === t.getFullYear() && date.getMonth() === t.getMonth() && date.getDate() === t.getDate()
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

const AVATAR_COLORS = ['bg-violet-500','bg-sky-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-teal-500','bg-orange-500','bg-pink-500']
function avatarColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)))
}

type Props = { currentUser: UserProfile }

export default function WeeklyCalendar({ currentUser }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [weekOffset, setWeekOffset] = useState(0)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>('default')

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStart = localDateString(weekDates[0])
  const weekEnd = localDateString(weekDates[6])

  // Toast helper
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  // Fetch shifts
  const fetchShifts = useCallback(async () => {
    const { data } = await supabase
      .from('shifts')
      .select('*, users(id, name, role)')
      .gte('date', weekStart)
      .lte('date', weekEnd)
    setShifts((data as Shift[]) ?? [])
    setLoading(false)
  }, [supabase, weekStart, weekEnd])

  // Realtime + fetch
  useEffect(() => {
    setLoading(true)
    fetchShifts()
    const channel = supabase
      .channel(`shifts-${weekStart}-${weekEnd}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, fetchShifts)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchShifts, supabase, weekStart, weekEnd])

  // Service worker registration
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    if (typeof Notification !== 'undefined') {
      setNotifPerm(Notification.permission)
    }
  }, [])

  // Push notification subscription
  async function enableNotifications() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      showToast('Notifications non supportées sur ce navigateur', false)
      return
    }
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm !== 'granted') {
      showToast('Permission refusée', false)
      return
    }
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return

    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      })
      await supabase.from('push_subscriptions').upsert(
        { user_id: currentUser.id, subscription: sub.toJSON() },
        { onConflict: 'user_id' }
      )
      showToast('Notifications activées ✓ Tu seras prévenu 24h avant chaque shift')
    } catch {
      showToast('Erreur lors de l\'activation des notifications', false)
    }
  }

  // Toggle shift
  async function toggleShift(date: string, half: 'AM' | 'PM') {
    const key = `${date}-${half}`
    if (toggling === key) return
    setToggling(key)

    const existing = shifts.find(s => s.user_id === currentUser.id && s.date === date && s.half === half)
    if (existing) {
      await supabase.from('shifts').delete().eq('id', existing.id)
      showToast(`Shift ${half} retiré`)
    } else {
      await supabase.from('shifts').insert({ user_id: currentUser.id, date, half })
      const d = new Date(date + 'T00:00:00')
      const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      showToast(`Shift ${half} confirmé — ${label} ✓`)
    }
    setToggling(null)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function getSlotShifts(date: string, half: 'AM' | 'PM') {
    return shifts.filter(s => s.date === date && s.half === half)
  }
  function hasMyShift(date: string, half: 'AM' | 'PM') {
    return shifts.some(s => s.user_id === currentUser.id && s.date === date && s.half === half)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium text-white flex items-center gap-2 transition-all ${toast.ok ? 'bg-slate-900' : 'bg-red-600'}`}>
          {toast.ok
            ? <svg className="w-4 h-4 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          }
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-900 text-sm">Fair Shifts</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <button
              onClick={notifPerm === 'granted' ? undefined : enableNotifications}
              title={notifPerm === 'granted' ? 'Notifications activées' : 'Activer les notifications'}
              className={`p-2 rounded-lg transition-colors ${notifPerm === 'granted' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              {notifPerm === 'granted'
                ? <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
                : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              }
            </button>

            <span className="text-sm text-slate-600 hidden sm:block truncate max-w-32">
              {currentUser.name}
              {currentUser.role === 'manager' && (
                <span className="ml-1 text-xs font-medium text-indigo-600">Manager</span>
              )}
            </span>
            <button onClick={handleSignOut} className="text-sm text-slate-500 hover:text-slate-700 font-medium whitespace-nowrap">
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Planning</h1>
            <p className="text-sm text-slate-500">{formatWeekRange(weekDates)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setWeekOffset(0)} className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
              Aujourd&apos;hui
            </button>
            <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Semaine précédente">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Semaine suivante">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>

        {/* ── MOBILE VIEW ── */}
        <div className="md:hidden space-y-3">
          {weekDates.map((date, i) => {
            const dateStr = localDateString(date)
            const today = isToday(date)
            return (
              <div key={i} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${today ? 'border-indigo-300' : 'border-slate-200'}`}>
                {/* Day header */}
                <div className={`px-4 py-2.5 flex items-center justify-between ${today ? 'bg-indigo-50' : 'bg-slate-50'}`}>
                  <span className={`font-semibold text-sm ${today ? 'text-indigo-700' : 'text-slate-700'}`}>
                    {DAY_LABELS_FULL[i]}
                  </span>
                  <span className={`text-sm ${today ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {formatDayFull(date)}
                    {today && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-indigo-600 text-white">Aujourd&apos;hui</span>}
                  </span>
                </div>

                {/* AM / PM cells */}
                <div className="grid grid-cols-2 divide-x divide-slate-100">
                  {HALVES.map(half => {
                    const key = `${dateStr}-${half}`
                    const slotShifts = getSlotShifts(dateStr, half)
                    const mine = hasMyShift(dateStr, half)
                    const isToggling = toggling === key

                    return (
                      <button
                        key={half}
                        onClick={() => toggleShift(dateStr, half)}
                        disabled={isToggling || loading}
                        className={`text-left p-3 min-h-[80px] transition-colors focus:outline-none active:opacity-70 ${mine ? 'bg-indigo-50' : 'hover:bg-slate-50'} ${isToggling ? 'opacity-50' : ''}`}
                      >
                        <div className={`text-xs font-bold tracking-widest mb-2 ${half === 'AM' ? 'text-sky-600' : 'text-amber-600'}`}>
                          {half}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {slotShifts.map(s => (
                            <MobileBadge key={s.id} shift={s} isMe={s.user_id === currentUser.id} />
                          ))}
                          {slotShifts.length === 0 && (
                            <span className="text-xs text-slate-300">+ ajouter</span>
                          )}
                        </div>
                        {mine && (
                          <div className="mt-2 text-xs text-indigo-500 font-medium">Appuyer pour retirer</div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── DESKTOP VIEW ── */}
        <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-200">
            <div />
            {weekDates.map((date, i) => (
              <div key={i} className={`py-3 px-2 text-center border-l border-slate-100 ${isToday(date) ? 'bg-indigo-50' : ''}`}>
                <div className={`text-xs font-semibold uppercase tracking-wide ${isToday(date) ? 'text-indigo-600' : 'text-slate-500'}`}>
                  {DAY_LABELS[i]}
                </div>
                <div className={`text-sm font-semibold mt-0.5 ${isToday(date) ? 'text-indigo-600' : 'text-slate-900'}`}>
                  {formatDayFull(date)}
                </div>
              </div>
            ))}
          </div>

          {/* AM / PM rows */}
          {HALVES.map((half, hi) => (
            <div key={half} className={`grid grid-cols-[56px_repeat(7,1fr)] ${hi === 0 ? 'border-b border-slate-200' : ''}`}>
              <div className="flex items-center justify-center py-4">
                <span className={`text-xs font-bold tracking-widest ${half === 'AM' ? 'text-sky-600' : 'text-amber-600'}`}>{half}</span>
              </div>
              {weekDates.map((date, di) => {
                const dateStr = localDateString(date)
                const key = `${dateStr}-${half}`
                const slotShifts = getSlotShifts(dateStr, half)
                const mine = hasMyShift(dateStr, half)
                const isToggling = toggling === key

                return (
                  <button
                    key={di}
                    onClick={() => toggleShift(dateStr, half)}
                    disabled={isToggling || loading}
                    className={[
                      'border-l border-slate-100 min-h-[96px] p-2 text-left align-top transition-colors focus:outline-none group',
                      isToday(date) ? 'bg-indigo-50/40 hover:bg-indigo-50' : 'hover:bg-slate-50',
                      mine ? 'ring-2 ring-inset ring-indigo-400' : '',
                      isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap gap-1">
                      {slotShifts.map(s => (
                        <DesktopBadge key={s.id} shift={s} isMe={s.user_id === currentUser.id} />
                      ))}
                      {slotShifts.length === 0 && (
                        <span className="text-xs text-slate-200 group-hover:text-slate-400 mt-1 transition-colors select-none">+ ajouter</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-400 mt-3 text-center">
          Appuie sur une case pour ajouter ou retirer ton shift
        </p>
      </main>
    </div>
  )
}

function MobileBadge({ shift, isMe }: { shift: Shift; isMe: boolean }) {
  const name = shift.users?.name ?? '?'
  const initials = getInitials(name)
  const color = avatarColor(shift.user_id)

  if (isMe) {
    return (
      <span className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-medium">
        <span className="w-4 h-4 rounded-full bg-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">{initials}</span>
        {name}
        <svg className="w-3 h-3 text-indigo-200 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-600">
      <span className={`w-4 h-4 rounded-full ${color} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>{initials}</span>
      {name}
    </span>
  )
}

function DesktopBadge({ shift, isMe }: { shift: Shift; isMe: boolean }) {
  const name = shift.users?.name ?? '?'
  const initials = getInitials(name)
  const color = avatarColor(shift.user_id)

  if (isMe) {
    return (
      <span className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-medium shadow-sm">
        <span className="w-4 h-4 rounded-full bg-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">{initials}</span>
        {name}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
      <span className={`w-4 h-4 rounded-full ${color} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>{initials}</span>
      {name}
    </span>
  )
}
