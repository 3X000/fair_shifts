export type UserProfile = {
  id: string
  name: string | null
  role: string
}

export type Shift = {
  id: string
  user_id: string
  date: string
  half: 'AM' | 'PM'
  created_at: string
  users: UserProfile
}
