const locks = new Set<string>()
export async function lock(
	filePath: string,
	_options: {
		onCompromised: (err: Error) => void
	}
): Promise<() => Promise<void>> {
	await sleep(1)

	if (locks.has(filePath)) {
		const err = new Error('ELOCKED: File is already locked')
		;(err as any).code = 'ELOCKED'
		throw err
	} else {
		locks.add(filePath)
	}

	return async () => {
		// release lock

		if (!locks.has(filePath)) {
			const err = new Error('ELOCKED: File is already released')
			;(err as any).code = 'ERELEASED'
			throw err
		} else {
			locks.delete(filePath)
		}
	}
}

async function sleep(duration: number): Promise<void> {
	return new Promise((r) => setTimeout(r, duration))
}
