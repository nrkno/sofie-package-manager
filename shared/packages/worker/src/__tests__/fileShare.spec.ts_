import { parseNetUse } from '../worker/accessorHandlers/fileShare'

describe('fileShare', () => {
	test('parseNetUse', () => {
		// Result on a computer with english locale:
		expect(
			parseNetUse(`New connections will be remembered.


Status       Local     Remote                    Network

-------------------------------------------------------------------------------
OK           Z:        \\\\localhost\\media         Microsoft Windows Network
The command completed successfully.
		`)
		).toEqual([
			{
				status: 'OK',
				statusOK: true,
				local: 'Z',
				remote: '\\\\localhost\\media',
				network: 'Microsoft Windows Network',
			},
		])

		// Result on a computer with a norwegian locale:
		expect(
			parseNetUse(`Nye tilkoblinger vil bli lagret.


Status       Lokalt    Eksternt                  Nettverk

-------------------------------------------------------------------------------
Ikke tilgjen U:        \\\\caspar01\\mamMediaScanner
                                                Microsoft Windows Network
Ikke tilgjen V:        \\nas.nrk\\Prod\\System\\mam
                                                Microsoft Windows Network
OK           Z:        \\\\aspar01\\mamMediaScanner
                                                Microsoft Windows Network
Kommandoen er fullført.
		`)
		).toEqual([
			{
				status: 'Ikke tilgjen',
				statusOK: false,
				local: 'U',
				remote: '\\\\caspar01\\mamMediaScanner',
				network: 'Microsoft Windows Network',
			},
			{
				status: 'Ikke tilgjen',
				statusOK: false,
				local: 'V',
				remote: '\\nas.nrk\\Prod\\System\\mam',
				network: 'Microsoft Windows Network',
			},
			{
				status: 'OK',
				statusOK: true,
				local: 'Z',
				remote: '\\\\aspar01\\mamMediaScanner',
				network: 'Microsoft Windows Network',
			},
		])
	})
})
export {}
