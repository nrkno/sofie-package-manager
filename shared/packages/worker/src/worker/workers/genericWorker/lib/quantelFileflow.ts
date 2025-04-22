import path from 'path'
import xml from 'xml-js'
import { stringifyError } from '@sofie-package-manager/api'
import { CancelablePromise } from '../../../lib/cancelablePromise'
import { fetchWithTimeout } from '../../../accessorHandlers/lib/fetch'

const DEFAULT_XML_JS_OPTIONS = {
	compact: true,
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

enum QuantelFileFlowStatus {
	WAITING = 'WAITING',
	PROCESSING = 'PROCESSING',
	COMPLETED = 'COMPLETED',
	FAILED = 'FAILED',
	ABORTING = 'ABORTING',
	ABORTED = 'ABORTED',
	CANCELLED = 'CANCELLED',
}

async function getJobStatus(
	fileFlowBaseUrl: string,
	jobId: string
): Promise<{ status: string; progress: number } | null> {
	const requestResponse = await fetchWithTimeout(`${fileFlowBaseUrl}/fileflowqueue/ffq/jobs/${jobId}`)
	if (requestResponse.ok) {
		const body = xml.xml2js(await requestResponse.text(), DEFAULT_XML_JS_OPTIONS) as xml.ElementCompact
		const status = body.QJobResponse?.QJob?.status?._text as string
		const progress = Number.parseFloat(body.QJobResponse?.QJob?.progress?._text)
		return {
			status,
			progress,
		}
	}

	return null
}

export function quantelFileFlowCopy(
	fileFlowBaseUrl: string,
	profileName: string | undefined,
	clipId: string,
	zoneId: string,
	destination: string,
	progressClb?: (progress: number) => void
): CancelablePromise<void> {
	return new CancelablePromise<void>((resolve, reject, onCancel) => {
		/**
		 * FileFlow uses a system where the name is set using a "rename rule", possibly to handle things like
		 * open essence clips (multiple files for a single clip). This means that it takes a PATH as a destination
		 * and then needs the desired fileName to be a part of the rename rule. The rename rule cannot affect the
		 * file extension, so that needs to be skipped as well.
		 */
		const destinationDirectory = path.win32.dirname(destination)
		const destinationExtension = path.win32.extname(destination)
		let destinationFilename = path.win32.basename(destination)
		destinationFilename = destinationFilename.substr(0, destinationFilename.length - destinationExtension.length)

		const jobRequest = {
			CreateJob: {
				destination: {
					_text: destinationDirectory,
				},
				jobType: {
					_text: 'export',
				},
				profileName: undefined as any,
				source: {
					_text: `SQ:${clipId}::${zoneId}`,
				},
				renameRule: {
					_text: 'REPLACE',
				},
				renameRuleText: {
					_text: destinationFilename,
				},
			},
		}

		if (profileName) {
			jobRequest.CreateJob.profileName = {
				_text: profileName,
			}
		}

		fetchWithTimeout(`${fileFlowBaseUrl}/fileflowqueue/ffq/jobs/`, {
			method: 'POST',
			body: xml.js2xml(jobRequest, DEFAULT_XML_JS_OPTIONS),
			headers: {
				'Content-Type': 'application/xml',
			},
		})
			.then(async (requestResponse) => {
				if (requestResponse.ok) {
					const body = xml.xml2js(await requestResponse.text(), DEFAULT_XML_JS_OPTIONS) as xml.ElementCompact
					const jobId = body.QJobResponse?.QJob?.id?._text as string
					let status = body.QJobResponse?.QJob?.status?._text as string
					let progress = Number.parseFloat(body.QJobResponse?.QJob?.progress?._text)

					onCancel(() => {
						const cancelJobRequest = {
							StatusChange: {
								status: {
									_text:
										status === QuantelFileFlowStatus.WAITING
											? QuantelFileFlowStatus.CANCELLED
											: QuantelFileFlowStatus.ABORTING,
								},
							},
						}
						fetchWithTimeout(`${fileFlowBaseUrl}/fileflowqueue/ffq/jobs/${jobId}/status`, {
							method: 'PUT',
							body: xml.js2xml(cancelJobRequest),
							headers: {
								'Content-Type': 'application/xml',
							},
						})
							.then((response) => {
								if (response.ok) {
									reject('Cancelled')
								} else {
									reject(
										`Bad response on FileFlow cancel job ${jobId}: ${response.status} ${response.statusText}`
									)
								}
							})
							.catch((err) => {
								reject(`Failed to execute FileFlow cancel job ${jobId} request: ${stringifyError(err)}`)
							})
					})

					while (
						status === QuantelFileFlowStatus.WAITING ||
						status === QuantelFileFlowStatus.PROCESSING ||
						status === QuantelFileFlowStatus.ABORTING
					) {
						await sleep(3000)
						const statusResult = await getJobStatus(fileFlowBaseUrl, jobId)
						if (statusResult) {
							status = statusResult.status
							progress = statusResult.progress

							if (progressClb) progressClb(progress)

							if (
								status === QuantelFileFlowStatus.ABORTED ||
								status === QuantelFileFlowStatus.CANCELLED ||
								status === QuantelFileFlowStatus.FAILED
							) {
								reject(`Failed: ${status}`)
								return
							} else if (status === QuantelFileFlowStatus.COMPLETED) {
								resolve(undefined)
								return
							}
						}
					}

					// at this point, the job should either be completed, or it has failed (note the while loop above)
					if (status === QuantelFileFlowStatus.COMPLETED) {
						resolve(undefined)
					} else {
						reject(`Quantel FileFlow status for job ${jobId}: ${status}`)
					}
				} else {
					reject(
						`Response is not Okay for creating FileFlow Export Job: ${
							requestResponse.status
						}: ${await requestResponse.text()}`
					)
				}
			})
			.catch((err) => reject(`Failed to execute FileFlow request: ${stringifyError(err)}`))
	})
}
