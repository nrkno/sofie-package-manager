import { AccessorOnPackage, Accessor } from '@sofie-automation/blueprints-integration'
import { Expectation, literal } from '@shared/api'
import { getAccessorHandle, isHTTPProxyAccessorHandle } from '../../../../accessorHandlers/accessor'
import { GenericAccessorHandle } from '../../../../accessorHandlers/genericHandle'
import { HTTPProxyAccessorHandle } from '../../../../accessorHandlers/httpProxy'
import { GenericWorker } from '../../../../worker'

export function getSourceHTTPHandle(
	worker: GenericWorker,
	sourceHandle: GenericAccessorHandle<any>,
	thumbnailURL: { baseURL: string; url: string }
): HTTPProxyAccessorHandle<any> {
	// This is a bit special, as we use the Quantel HTTP-transformer to extract the thumbnail,
	// so we have a QUANTEL source, but we construct an HTTP source from it to use instead:

	const handle = getAccessorHandle<QuantelClipMetadata>(
		worker,
		sourceHandle.accessorId + '__http',
		literal<AccessorOnPackage.HTTPProxy>({
			type: Accessor.AccessType.HTTP_PROXY,
			baseUrl: thumbnailURL.baseURL,
			// networkId?: string
			url: thumbnailURL.url,
		}),
		{ filePath: thumbnailURL.url },
		{}
	)
	if (!isHTTPProxyAccessorHandle(handle)) throw new Error(`getSourceHTTPHandle: got a non-HTTP handle!`)
	return handle
}

export interface QuantelClipMetadata {
	sourceVersionHash: string
	version: Expectation.Version.QuantelClipThumbnail
}
