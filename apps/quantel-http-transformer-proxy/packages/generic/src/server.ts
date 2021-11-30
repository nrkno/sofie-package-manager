import Koa from 'koa'
import Router from 'koa-router'
import cors from '@koa/cors'
import range from 'koa-range'
import { default as got } from 'got'
import { QuantelHTTPTransformerProxyConfig, LoggerInstance, stringifyError } from '@shared/api'
import { parseStringPromise as xmlParser } from 'xml2js'

export class QuantelHTTPTransformerProxy {
	private app = new Koa()
	private router = new Router()
	private transformerURL: string | undefined = undefined
	private smoothStream = false

	constructor(private logger: LoggerInstance, private config: QuantelHTTPTransformerProxyConfig) {
		if (this.config.quantelHTTPTransformerProxy.transformerURL) {
			this.transformerURL = this.config.quantelHTTPTransformerProxy.transformerURL
		}
		if (this.transformerURL !== undefined) {
			while (this.transformerURL.endsWith('/')) {
				this.transformerURL = this.transformerURL.slice(0, -1)
			}
		}
		this.smoothStream = false // this.config.quantelHTTPTransformerProxy.streamType === QuantelStreamType.SMOOTH_STREAM
		this.app.on('error', (err) => this.logger.warn(`QuantelHTTPTransformerProxy Error: ${stringifyError(err)}`))
		this.app.use(range)

		this.app.use(
			cors({
				origin: '*',
			})
		)
	}

	init(): Promise<void> {
		this.router.get('/hello', async (ctx, next) => {
			ctx.body = { msg: 'Hello World', params: ctx.params }
			await next()
		})

		// Proxy
		this.router.get('/(quantel|gv)/*', async (ctx) => {
			try {
				// this.logger.debug(`Pass-through requests to transformer: ${ctx.path}`)
				if (!this.transformerURL) {
					ctx.status = 502
					ctx.body = 'Transformer URL not set. Cannot talk to HTTP transformer.'
					this.logger.warn('Transformer URL not set. Cannot talk to HTTP transformer.')
					return
				}
				if (ctx.path.endsWith('init.mp4')) {
					const initReq = await got(`${this.transformerURL}${ctx.path}`, { responseType: 'buffer' })
					const initBuf = initReq.body
					const stsc = initBuf.indexOf('stsc')
					initBuf.writeUInt32BE(0, stsc + 8)
					const stco = initBuf.indexOf('stco')
					initBuf.writeUInt32BE(0, stco + 8)
					ctx.type = initReq.headers['content-type'] || 'video/mpeg-4'
					ctx.body = initBuf
					return
				}
				if (this.smoothStream && ctx.path.endsWith('stream.mpd')) {
					const smoothFestRes = await got(`${this.transformerURL}${ctx.path.slice(0, -4)}.xml`)
					ctx.type = 'application/xml'
					ctx.body = await manifestTransform(smoothFestRes.body)
					return
				} else {
					// TODO - ideally this would stream - but that would hang on longer payloads
					const initReq = await got(`${this.transformerURL}${ctx.path}`, { responseType: 'buffer' })
					ctx.type = initReq.headers['content-type'] || 'application/octet-stream'
					ctx.body = initReq.body

					// await next() // todo: should we do this?
				}
			} catch (err: any) {
				if (err.response) {
					// Pass through response:
					ctx.status = err.response.statusCode
					ctx.body = err.response.body?.toString() || ''
					if (err.response.headers) {
						for (const header of Object.keys(err.response.headers)) {
							ctx.set(header, err.response.headers[header])
						}
					}
				} else {
					throw err
				}
			}
		})
		this.router.get('/*', async (ctx, next) => {
			try {
				const initReq = await got(
					`${this.transformerURL}${ctx.path}` + (ctx.querystring ? `?${ctx.querystring}` : ''),
					{ responseType: 'buffer' }
				)
				ctx.type = initReq.headers['content-type'] || 'application/octet-stream'
				ctx.body = initReq.body

				await next()
			} catch (err: any) {
				if (err.response) {
					// Pass through response:
					ctx.status = err.response.statusCode
					ctx.body = err.response.body?.toString() || ''
					if (err.response.headers) {
						for (const header of Object.keys(err.response.headers)) {
							ctx.set(header, err.response.headers[header])
						}
					}
				} else {
					throw err
				}
			}
		})

		this.app.use(this.router.routes()).use(this.router.allowedMethods())

		return new Promise<void>((resolve) => {
			const port = this.config.quantelHTTPTransformerProxy.port
			if (port) {
				this.app.listen(port, () => {
					this.logger.info(`Quantel-HTTP-transformer-proxy: Server started on HTTP port ${port}`)
					resolve()
				})
			}
		})
	}
}

async function manifestTransform(ssxml: string): Promise<string> {
	const ssjs = await xmlParser(ssxml)
	// console.dir(ssjs.SmoothStreamingMedia.StreamIndex, { depth: 10 })
	const ssm = ssjs.SmoothStreamingMedia
	const duration = (+ssm.$.Duration / +ssm.$.TimeScale).toFixed(3)
	const video = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'video')
	const header =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<MPD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:scte35="http://www.scte.org/schemas/35/2014SCTE35.xsd" xsi:schemaLocation="urn:mpeg:dash:schema:mpd:2011 DASH-MPD.xsd" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" minBufferTime="PT5.000S" maxSegmentDuration="PT3.000S" availabilityStartTime="2016-01-20T21:10:02Z" mediaPresentationDuration="PT${duration}S">\n` +
		`  <Period id="period0" duration="PT${duration}S">\n`
	let vAdapt = `    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" maxWidth="${video.$.DisplayWidth}" maxHeight="${video.$.DisplayHeight}" maxFrameRate="${video.$.Fps}" par="1:1">\n`
	for (const ql of video.QualityLevel) {
		vAdapt += `      <Representation id="${ql.$.Bitrate}" bandwidth="${ql.$.Bitrate}" codecs="avc1.4D401E" width="${ql.$.MaxWidth}" height="${ql.$.MaxHeight}" frameRate="${video.$.Fps}" sar="1:1" scanType="progressive">\n`
		vAdapt += `        <BaseURL>stream-mp4/video/</BaseURL>\n`
		vAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		vAdapt += `          <SegmentTimeline>\n`
		for (const seg of video.c) {
			vAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		vAdapt += `          </SegmentTimeline>\n`
		vAdapt += `        </SegmentTemplate>\n`
		vAdapt += `      </Representation>\n`
	}
	vAdapt += `    </AdaptationSet>\n`
	const audio = ssjs.SmoothStreamingMedia.StreamIndex.find((x: any): any => x.$.Type === 'audio')
	let aAdapt = ''
	if (audio) {
		const ql = audio.QualityLevel[0].$
		aAdapt += `    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1" lang="qaa">\n`
		aAdapt += `      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2" audioSamplingRate="48000">\n`
		aAdapt += `        <BaseURL>${audio.$.Url.slice(0, audio.$.Url.indexOf('{'))}</BaseURL>\n`
		aAdapt += `        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${ql.Channels}"/>\n`
		aAdapt += `        <SegmentTemplate timescale="${ssm.$.TimeScale}" initialization="init.mp4" media="$Time$.mp4" duration="${ssm.$.Duration}" presentationTimeOffset="0">\n`
		aAdapt += `          <SegmentTimeline>\n`
		for (const seg of audio.c) {
			aAdapt += `            <S t="${seg.$.t}" d="${seg.$.d}" />\n`
		}
		aAdapt += `          </SegmentTimeline>\n`
		aAdapt += `        </SegmentTemplate>\n`
		aAdapt += `      </Representation>\n`
		aAdapt += `    </AdaptationSet>\n`
	}
	const footer = `  </Period>\n` + `</MPD>\n`
	return header + vAdapt + aAdapt + footer
}
