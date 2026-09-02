import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { message } from '@chaos_team/chaos-ui'
import { getMessage } from '../api/account'

/** Poll backend announcements (admin /api/admin/message/get) and toast new ones.
 * Mount once at app level. */
export default function MessagePoller({ enabled }: { enabled: boolean }) {
  const q = useQuery({
    queryKey: ['message'],
    queryFn: async () => {
      try {
        return await getMessage()
      } catch {
        // 404 "no message" is the normal case
        return null
      }
    },
    enabled,
    refetchInterval: 30_000,
    retry: false,
  })

  useEffect(() => {
    if (q.data) {
      const m = q.data
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      if (m.type === 'text' || !m.type) message.info(text)
      else if (m.type === 'error') message.error(text)
      else message.success(text)
    }
  }, [q.data])

  return null
}
