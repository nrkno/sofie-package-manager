import { ClipData } from 'tv-automation-quantel-gateway-client/dist/quantelTypes'

/*
	These functions come from the media-manager originally
*/

/**
 * This function returns a fake FFInfo object, based upon the Quantel ClipData object
 */
export function generateFFProbeFromClipData(clipData: ClipData): any {
	if (clipData.VideoFormats === '') {
		throw new Error('Cannot make video stream metadata with an empty video format.')
	}
	// Some videos have multiple formats, e.g. "0 611 633" ... this works with the highest number
	const videoFormat = clipData.VideoFormats.split(' ')
		.map((x) => +x)
		.sort((a, b) => a - b) // sort alphabetically
		.reverse()[0]
	let audioFormat: number
	if (clipData.AudioFormats === '') {
		// Streams can be published without audio
		audioFormat = -1
	}
	audioFormat = clipData.AudioFormats.split(' ')
		.map((x) => +x)
		.sort((a, b) => a - b) // sort alphabetically
		.reverse()[0]

	return {
		name: clipData.Title,
		streams: [makeVideoStream(clipData, videoFormat)].concat(makeAudioStreams(clipData, audioFormat)),
		format: makeFormat(clipData, videoFormat, audioFormat),
	}
}

function makeVideoStream(clipData: ClipData, videoFormat: number): any {
	const targetVideo: any = {
		index: 0,
		codec_name: videoFormat > 100 ? 'h264' : 'mpeg2video',
		codec_long_name: videoFormat > 100 ? 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10' : 'MPEG-2 video',
		profile: videoFormat > 100 ? 'High 4:2:2 Intra' : '4:2:2',
		codec_type: 'video',
		codec_time_base: videoFormat > 100 ? '1/50' : '1/25',
		codec_tag_string: '[0][0][0][0]',
		codec_tag: '0x0000',
		width: videoFormat > 100 ? 1920 : 720,
		height: videoFormat > 100 ? 1080 : 608,
		coded_width: videoFormat > 100 ? 1920 : 0,
		coded_height: videoFormat > 100 ? 1088 : 0,
		has_b_frames: 0,
		sample_aspect_ratio: videoFormat > 100 ? '1:1' : '608:405',
		display_aspect_ratio: '16:9',
		pix_fmt: videoFormat > 100 ? 'yuv422p10le' : 'yuv422p',
		level: videoFormat > 100 ? 41 : 5,
		color_range: 'tv',
		color_space: 'bt709',
		color_transfer: 'bt709',
		color_primaries: 'bt709',
		chroma_location: videoFormat > 100 ? 'left' : 'topleft',
		field_order: 'tt',
		refs: 1,
		is_avc: 'false',
		nal_length_size: '0',
		r_frame_rate: '25/1',
		avg_frame_rate: '25/1',
		time_base: '1/25',
		start_pts: 0,
		start_time: '0.000000',
		duration_ts: +clipData.Frames,
		duration: `${+clipData.Frames / 25}`,
		bits_per_raw_sample: videoFormat > 100 ? '10' : '8',
		disposition: {
			default: 0,
			dub: 0,
			original: 0,
			comment: 0,
			lyrics: 0,
			karaoke: 0,
			forced: 0,
			hearing_impaired: 0,
			visual_impaired: 0,
			clean_effects: 0,
			attached_pic: 0,
			timed_thumbnails: 0,
		},
		tags: {
			source_video_formats: clipData.VideoFormats,
			sofie_selects_video_format: videoFormat,
		},
	}

	if (videoFormat < 100) {
		// remove non-AVC flags for MPEG-2 video
		delete targetVideo.is_avc
		delete targetVideo.nal_length_size
	}

	return targetVideo
}

// Note: SD videos have one audio track with 4 or 8 channels - not represented here
function makeAudioStreams(clipData: ClipData, audioFormat: number): any[] {
	const streams: any[] = []
	if (audioFormat === -1) {
		return streams
	}
	const noOfStreams = audioFormat <= 522 ? 4 : 8

	for (let index = 1; index <= noOfStreams; index++) {
		streams.push({
			index: index,
			codec_name: audioFormat === 521 || audioFormat === 523 ? 'pcm_s16le' : 'pcm_s24le',
			codec_long_name: `PCM signed ${audioFormat === 521 || audioFormat === 523 ? 16 : 24}-bit little-endian`,
			codec_type: 'audio',
			codec_time_base: '1/48000',
			codec_tag_string: '[0][0][0][0]',
			codec_tag: '0x0000',
			sample_fmt: audioFormat === 521 || audioFormat === 523 ? 's16' : 's32',
			sample_rate: '48000',
			channels: 1,
			bits_per_sample: audioFormat === 521 || audioFormat === 523 ? 16 : 24,
			r_frame_rate: '0/0',
			avg_frame_rate: '0/0',
			time_base: '1/48000',
			start_pts: 0,
			start_time: '0.000000',
			duration_ts: +clipData.Frames * 1920,
			duration: `${+clipData.Frames / 25}`,
			bit_rate: `${audioFormat === 521 || audioFormat === 523 ? 768000 : 1152000}`,
			bits_per_raw_sample: audioFormat === 521 || audioFormat === 523 ? '16' : '24',
			nb_frames: +clipData.Frames,
			disposition: {
				default: 0,
				dub: 0,
				original: 0,
				comment: 0,
				lyrics: 0,
				karaoke: 0,
				forced: 0,
				hearing_impaired: 0,
				visual_impaired: 0,
				clean_effects: 0,
				attached_pic: 0,
				timed_thumbnails: 0,
			},
			tags: {
				source_audio_formats: clipData.AudioFormats,
				sofie_selects_autio_format: audioFormat, // kept for backwards compatibility
				sofie_selects_audio_format: audioFormat,
			},
		})
	}

	return streams
}

function makeFormat(clipData: ClipData, videoFormat: number, audioFormat: number): any {
	// FFprobe guesses bitrate and size based on first 100 frames ... this guesses at the guess
	let bitrate = 0
	switch (videoFormat) {
		case 91:
			bitrate = 62600000
			break
		case 611:
			bitrate = 120000000
			break
		default:
			// case 633:
			bitrate = 152000000
			break
	}

	return {
		filename: `quantel:${clipData.ClipGUID}`,
		nb_streams: audioFormat === -1 ? 1 : audioFormat <= 522 ? 5 : 9,
		nb_programs: 0,
		format_name: 'mxf',
		format_long_name: 'MXF (Material eXchange Format)',
		start_time: '0.000000',
		duration: `${+clipData.Frames / 25}`,
		size: `${Math.floor((bitrate * +clipData.Frames) / 25 / 8)}`,
		bit_rate: `${bitrate}`,
		probe_score: 100,
		tags: {
			operational_pattern_ul: '060e2b34.04010101.0d010201.01010900',
			company_name: 'QUANTEL',
			product_name: 'Media Transformer',
			product_version: 'V7.2.2',
			application_platform: 'Sony MXF Development Kit (Win32)',
			product_uid: 'b4d908cf-53d5-4b41-91a4-82e018e69daa',
			modification_date: clipData.Modified,
			timecode: '00:00:00:00',
		},
	}
}

/**
 * Data used to make bitrate guess
 * clipID formats    bitrate       size
 * format code 633/524
 * 751189  353  151424695  267264588
 * 741202  278  152065804  211371468
 * 751184  252  152377132  191995187
 * 751199  746  150172798  560144537
 * 751181 1762  149524404 1317310003
 * 751205  118  156157308   92132812
 * 751196  520  150661513  391719936
 * 751193  125  155759206   97349504
 * 751223  372  151303322  281424179
 * 751214  125  155759206   97349504
 *
 * Format code 91/524
 * 753279 3950   62572806 1235812924
 *
 * Format code 91/521
 *  12532  200   62637842   65143356
 *  12587 1629   62575082  509674044
 *
 * Format code 611/522
 * 757242  120  119058020   71434812
 *
 * Format code 611/524
 * 751386 37826 123802160 23414702652
 */
