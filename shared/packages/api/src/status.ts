// eslint-disable-next-line node/no-extraneous-import
import { StatusCode } from '@sofie-automation/server-core-integration'

export type Statuses = {
	[key: string]: Status | null
}
export type Status = { message: string; statusCode: StatusCode }
