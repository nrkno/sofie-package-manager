// eslint-disable-next-line node/no-extraneous-import
import { ExpectedPackageStatusAPI } from '@sofie-automation/shared-lib/dist/package-manager/package'
import { assertNever, stringifyError } from '@sofie-package-manager/api'
import { EvaluationRunner } from './evaluationRunner'
import { InternalManager } from '../internalManager/internalManager'
import { ExpectationTracker } from '../expectationTracker/expectationTracker'
import { EvaluateContext } from './lib'
import { evaluateExpectationStateAborted } from './evaluateExpectationStates/aborted'
import { evaluateExpectationStateFulfilled } from './evaluateExpectationStates/fulfilled'
import { evaluateExpectationStateNew } from './evaluateExpectationStates/new'
import { evaluateExpectationStateReady } from './evaluateExpectationStates/ready'
import { evaluateExpectationStateRemoved } from './evaluateExpectationStates/removed'
import { evaluateExpectationStateRestarted } from './evaluateExpectationStates/restarted'
import { evaluateExpectationStateWaiting } from './evaluateExpectationStates/waiting'
import { evaluateExpectationStateWorking } from './evaluateExpectationStates/working'
import { TrackedExpectation, expLabel } from '../lib/trackedExpectation'

/** Evaluate the state of an Expectation */
export async function evaluateExpectationState(
	runner: EvaluationRunner,
	trackedExp: TrackedExpectation
): Promise<void> {
	const manager: InternalManager = runner.manager
	const tracker: ExpectationTracker = runner.tracker

	trackedExp.skipEvaluationCount = 0 // Reset the skip count

	const timeSinceLastEvaluation = Date.now() - trackedExp.lastEvaluationTime
	if (trackedExp.session.hadError) return // There was an error during the session.

	if (trackedExp.session.expectationCanBeRemoved) return // The expectation has been removed

	const lastErrorTime = trackedExp.lastError?.time || 0
	const timeSinceLastError = Date.now() - lastErrorTime

	if (
		timeSinceLastError < tracker.constants.ERROR_WAIT_TIME &&
		trackedExp.state !== ExpectedPackageStatusAPI.WorkStatusState.RESTARTED
	) {
		runner.logger.silly(
			`Skipping expectation state evaluation of "${expLabel(trackedExp)}" (${trackedExp.exp.type}), ` +
				`because it's time from last error (${timeSinceLastError}ms) is less than ` +
				`${tracker.constants.ERROR_WAIT_TIME}ms`
		)
		return // Don't run again too soon after an error, unless it's a manual restart
	}

	const context: EvaluateContext = {
		manager,
		tracker,
		runner,
		trackedExp,
		timeSinceLastEvaluation,
	}
	try {
		if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.NEW) {
			await evaluateExpectationStateNew(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WAITING) {
			await evaluateExpectationStateWaiting(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.READY) {
			await evaluateExpectationStateReady(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.WORKING) {
			await evaluateExpectationStateWorking(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.FULFILLED) {
			await evaluateExpectationStateFulfilled(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.REMOVED) {
			await evaluateExpectationStateRemoved(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.RESTARTED) {
			await evaluateExpectationStateRestarted(context)
		} else if (trackedExp.state === ExpectedPackageStatusAPI.WorkStatusState.ABORTED) {
			await evaluateExpectationStateAborted(context)
		} else {
			assertNever(trackedExp.state)
		}
	} catch (err) {
		runner.logger.error(
			`Error thrown in evaluateExpectationState for expectation "${expLabel(trackedExp)}": ${stringifyError(err)}`
		)
		tracker.trackedExpectationAPI.updateTrackedExpectationStatus(trackedExp, {
			reason: {
				user: 'Internal error in Package Manager',
				tech: `${stringifyError(err)}`,
			},
			isError: true,
		})
	}
}
