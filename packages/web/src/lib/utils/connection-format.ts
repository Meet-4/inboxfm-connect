import { AppConnectionType } from '@/lib/api/types'

function connectionTypeLabel(type: AppConnectionType | string): string {
  switch (type) {
    case 'OAUTH2':
      return 'OAuth 2.0'
    // Connections created through the public /connect/:token flow land in the
    // project's connection list with these types; without explicit cases the
    // table rendered the raw enum value ("PLATFORM_OAUTH2").
    case 'PLATFORM_OAUTH2':
      return 'Platform OAuth 2.0'
    case 'CLOUD_OAUTH2':
      return 'Cloud OAuth 2.0'
    case 'SECRET_TEXT':
      return 'API Key'
    case 'BASIC_AUTH':
      return 'Basic Auth'
    case 'CUSTOM_AUTH':
      return 'Custom Auth'
    default:
      return type
  }
}

export const connectionFormat = {
  connectionTypeLabel,
}
