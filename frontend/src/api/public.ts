import { request } from './client'
import type { PublicSettings } from './types'

/** Site settings visible to everyone (preview types, viewers, autoplay...). */
export function getPublicSettings() {
  return request<PublicSettings>('/api/public/settings')
}
