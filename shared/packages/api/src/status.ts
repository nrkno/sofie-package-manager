import { StatusCode } from '@sofie-automation/blueprints-integration'

export interface Statuses {
	[key: string]: { message: string; statusCode: StatusCode } | null
}
