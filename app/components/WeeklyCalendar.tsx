'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Shift, UserProfile } from '@/lib/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HALVES: ('AM' | 'PM')[] = ['AM', 'PM']

function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

function formatHeaderDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function formatWeekRange(dates: Date[]): string {
  const start = dates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const end = dates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return `${start} – ${end}`
}

function isToday(date: Date): boolean {
  const today = new Date()
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

// Deterministic color per user id (from a small palette)
const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-pink-500',
]
function avatarColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

type Props = {
  currentUser: UserProfile
}

export default function WeeklyCalendar({ currentUser }: Props) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [weekOffset, setWeekOffset] = useState(0)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null) // "date-half" key

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStart = localDateString(weekDates[0])
  const weekEnd = localDateString(weekDates[6])

  const fetchShifts = useCallback(async () => {
    const { data, error } = await supabase
      .from('shifts')
      .select('*, users(id, name, role)')
      .gte('date', weekStart)
      .lte('date', weekEnd)

    if (!error && data) {
      setShifts(data as Shift[])
    }
    setLoading(false)
  }, [supabase, weekStart, weekEnd])

  useEffect(() => {
    setLoading(true)
    fetchShifts()

    const channel = supabase
      .channel(`shifts-${weekStart}-${weekEnd}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts' },
        () => { fetchShifts() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [fetchShifts, supabase, weekStart, weekEnd])

  async function toggleShift(date: string, half: 'AM' | 'PM') {
    const key = `${date}-${half}`
    if (toggling === key) return
    setToggling(key)

    const existing = shifts.find(
      s => s.user_id === currentUser.id && s.date === date && s.half === half
    )

    if (existing) {
      await supabase.from('shifts').delete().eq('id', existing.id)
    } else {
      await supabase
        .from('shifts')
        .insert({ user_id: currentUser.id, date, half })
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
    return shifts.some(
      s => s.user_id === currentUser.id && s.date === date && s.half === half
    )
  }

  const today = localDateString(new Date())

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-900 text-sm">Fair Shifts</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 hidden sm:block">
              {currentUser.name ?? currentUser.id}
              {currentUser.role === 'manager' && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                  Manager
                </span>
              )}
            </span>
            <button
              onClick={handleSignOut}
              className="text-sm text-slate-500 hover:text-slate-700 font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Schedule</h1>
            <p className="text-sm text-slate-500 mt-0.5">{formatWeekRange(weekDates)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset(0)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            >
              Today
            </button>
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="Previous week"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => setWeekOffset(w => w + 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              aria-label="Next week"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Calendar grid */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-[64px_repeat(7,1fr)] border-b border-slate-200">
            <div className="py-3 px-2" />
            {weekDates.map((date, i) => {
              const dateStr = localDateString(date)
              return (
                <div
                  key={i}
                  className={`py-3 px-2 text-center border-l border-slate-200 ${isToday(date) ? 'bg-indigo-50' : ''}`}
                >
                  <div className={`text-xs font-medium uppercase tracking-wide ${isToday(date) ? 'text-indigo-600' : 'text-slate-500'}`}>
                    {DAY_LABELS[i]}
                  </div>
                  <div className={`text-sm font-semibold mt-0.5 ${isToday(date) ? 'text-indigo-600' : 'text-slate-900'}`}>
                    {formatHeaderDate(date)}
                  </div>
                  {dateStr === today && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 mx-auto mt-1" />
                  )}
                </div>
              )
            })}
          </div>

          {/* AM / PM rows */}
          {HALVES.map((half, hi) => (
            <div
              key={half}
              className={`grid grid-cols-[64px_repeat(7,1fr)] ${hi === 0 ? 'border-b border-slate-200' : ''}`}
            >
              {/* Row label */}
              <div className="flex items-center justify-center py-4 px-2">
                <span className={`text-xs font-bold tracking-widest ${half === 'AM' ? 'text-sky-600' : 'text-amber-600'}`}>
                  {half}
                </span>
              </div>

              {/* Cells */}
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
                      'border-l border-slate-200 min-h-[96px] p-2 text-left align-top transition-colors',
                      'hover:bg-slate-50 focus:outline-none focus:bg-slate-50',
                      isToday(date) ? 'bg-indigo-50/50 hover:bg-indigo-50' : '',
                      mine ? 'ring-2 ring-inset ring-indigo-400' : '',
                      isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <div className="flex flex-wrap gap-1">
                      {slotShifts.map(shift => (
                        <ShiftBadge
                          key={shift.id}
                          shift={shift}
                          isMe={shift.user_id === currentUser.id}
                        />
                      ))}
                      {slotShifts.length === 0 && !loading && (
                        <span className="text-xs text-slate-300 select-none mt-1">
                          + add
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <p className="text-xs text-slate-400 mt-3 text-center">
          Click any cell to toggle your shift. Changes sync in real time.
        </p>
      </main>
    </div>
  )
}

function ShiftBadge({ shift, isMe }: { shift: Shift; isMe: boolean }) {
  const name = shift.users?.name ?? 'Unknown'
  const initials = getInitials(name)
  const color = avatarColor(shift.user_id)

  if (isMe) {
    return (
      <span className="inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full bg-indigo-600 text-white text-xs font-medium shadow-sm">
        <span className="w-4 h-4 rounded-full bg-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">
          {initials}
        </span>
        {name}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full ${color} bg-opacity-10 text-xs font-medium text-slate-700`}>
      <span className={`w-4 h-4 rounded-full ${color} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
        {initials}
      </span>
      {name}
    </span>
  )
}
