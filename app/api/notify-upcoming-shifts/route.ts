import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  // Protect the cron endpoint
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 })
  }

  webpush.setVapidDetails('mailto:admin@fairshifts.app', vapidPublic, vapidPrivate)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Find shifts for tomorrow
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]

  const { data: shifts } = await supabase
    .from('shifts')
    .select('user_id, half, users(name)')
    .eq('date', tomorrowStr)

  if (!shifts?.length) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const shift of shifts) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', shift.user_id)

    for (const row of subs ?? []) {
      try {
        await webpush.sendNotification(
          row.subscription as webpush.PushSubscription,
          JSON.stringify({
            title: 'Fair Shifts — Rappel shift',
            body: `Tu as un shift ${shift.half} demain. Bonne journée !`,
          })
        )
        sent++
      } catch {
        // Subscription expired — ignore
      }
    }
  }

  return NextResponse.json({ sent })
}
