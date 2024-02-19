import { ProtectedString, protectString } from './ProtectedString'

// From Core
export type ExpectedPackageId = ProtectedString<'ExpectedPackageId', string>

// Workforce
export type WorkforceId = ProtectedString<'WorkforceId', string>
export const WORKFORCE_ID: WorkforceId = protectString<WorkforceId>('workforce')

// Expectation Manager:
export type ExpectationManagerId = ProtectedString<'ExpectationManagerId', string>
export type PackageContainerId = ProtectedString<'PackageContainerId', string>
// export { ExpectedPackageId } from '@sofie-automation/shared-lib/dist/core/model/Ids'

export type WorkInProgressId = ProtectedString<'WorkInProgressId', string>

// AppContainer:
export type AppContainerId = ProtectedString<'AppContainerId', string>
export type AppType = ProtectedString<'AppType', string>
export type AppId = WorkerAgentId // | OtherWorkerType?

// Worker:
export type WorkerAgentId = ProtectedString<'WorkerAgentId', string>
export type MonitorId = ProtectedString<'MonitorId', string>
/** Work-in-progress id, locally unique to a Worker */
export type WorkInProgressLocalId = ProtectedString<'WorkInProgressLocalId', string>

// Expectations
export type ExpectationId = ProtectedString<'ExpectationId', string>

export type AccessorId = ProtectedString<'AccessorId', string>
