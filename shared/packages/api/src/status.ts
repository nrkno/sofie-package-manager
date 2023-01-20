// eslint-disable-next-line node/no-extraneous-import
import { StatusCode } from '@sofie-automation/shared-lib/dist/lib/status'

export interface Statuses {
	[key: string]: { message: string; statusCode: StatusCode } | null
}
