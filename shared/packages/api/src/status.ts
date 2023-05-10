// eslint-disable-next-line node/no-extraneous-import
import { StatusCode } from '@sofie-automation/server-core-integration'

export interface Statuses {
	[key: string]: { message: string; statusCode: StatusCode } | null
}
