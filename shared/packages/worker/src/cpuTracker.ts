import * as os from 'os'

/** If a cpu usage is below this, it is considered to be idle */
const IDLE_CPU_THRESHOLD = 0.25

/** Calculate and tracks the current CPU usage */
export class CPUTracker {
	private _interval: NodeJS.Timeout

	private _previousCPUs: CPUInfo[]
	private _previousSum: CPUInfo

	private _cpuUsage: number
	private _idleCPUCount: number

	constructor(measureInterval = 5000) {
		// Initial values:
		{
			this._previousCPUs = this.getCPUs()
			this._previousSum = this.sumCPUs(this._previousCPUs)
			this._cpuUsage = 0
			this._idleCPUCount = 0
		}

		this._interval = setInterval(() => {
			this._update()
		}, measureInterval)
	}
	public terminate(): void {
		clearInterval(this._interval)
	}

	/** What the total CPU usage is at the moment. Returns a number 0-1 */
	public get cpuUsage(): number {
		return this._cpuUsage
	}
	/** The number of the currently "idle" CPU cores */
	public get idleCPUCount(): number {
		return this._idleCPUCount
	}

	private _update() {
		const cpus = this.getCPUs()
		const sum = this.sumCPUs(cpus)

		{
			const deltaBusy = sum.busy - this._previousSum.busy
			const deltaTotal = sum.total - this._previousSum.total
			this._cpuUsage = deltaBusy / deltaTotal
		}

		this._idleCPUCount = 0
		for (let i = 0; i < cpus.length; i++) {
			const cpu = cpus[i]
			const prevCPU = this._previousCPUs[i]

			const deltaBusy = cpu.busy - prevCPU.busy
			const deltaTotal = cpu.total - prevCPU.total

			const usage = deltaBusy / deltaTotal

			if (usage < IDLE_CPU_THRESHOLD) {
				this._idleCPUCount++
			}
		}

		// Last:
		this._previousCPUs = cpus
		this._previousSum = sum
	}
	private getCPUs() {
		const cpus = os.cpus()
		const calculated: CPUInfo[] = []
		for (const cpu of cpus) {
			const busy = cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq
			const total = busy + cpu.times.idle
			calculated.push({ busy, total })
		}
		return calculated
	}
	private sumCPUs(cpus: CPUInfo[]): CPUInfo {
		const busy = cpus.reduce((mem, cpu) => mem + cpu.busy, 0)
		const total = cpus.reduce((mem, cpu) => mem + cpu.total, 0)
		return { busy, total }
	}
}
interface CPUInfo {
	busy: number
	total: number
}
