export interface WorkerJob {
	id: string;
	payload: Record<string, unknown>;
}

export class EventsWorker {
	private readonly processed: WorkerJob[] = [];

	constructor(private readonly queueName: string) {}

	async process(job: WorkerJob): Promise<void> {
		this.processed.push(job);
		console.info(`[worker] processed job ${job.id} from ${this.queueName}`);
	}

	getProcessedJobs(): WorkerJob[] {
		return [...this.processed];
	}
}

export function createWorker(): EventsWorker {
	return new EventsWorker("events.high");
}
