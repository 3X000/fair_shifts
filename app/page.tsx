import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import WeeklyCalendar from '@/app/components/WeeklyCalendar'

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get profile, auto-creating it on first login
  let { data: profile } = await supabase
    .from('users')
    .select('id, name, role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    const defaultName = user.email?.split('@')[0] ?? 'Staff'
    const { data: inserted } = await supabase
      .from('users')
      .insert({ id: user.id, name: defaultName, role: 'staff' })
      .select('id, name, role')
      .single()
    profile = inserted
  }

  const currentUser = profile ?? {
    id: user.id,
    name: user.email?.split('@')[0] ?? 'Staff',
    role: 'staff',
  }

  return <WeeklyCalendar currentUser={currentUser} />
}
