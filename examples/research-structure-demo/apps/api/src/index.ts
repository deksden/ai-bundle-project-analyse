export interface ApiMetrics {
	uptimeSeconds: number;
	activeQueues: string[];
	externalSystems: string[];
}

export function createApiGateway(): {
	start: () => Promise<void>;
	stop: () => Promise<void>;
	getMetrics: () => ApiMetrics;
} {
	let startedAt = 0;

	return {
		async start() {
			startedAt = Date.now();
			console.info("[api] gateway started");
		},
		async stop() {
			startedAt = 0;
			console.info("[api] gateway stopped");
		},
		getMetrics(): ApiMetrics {
			const uptimeSeconds = startedAt === 0 ? 0 : Math.floor((Date.now() - startedAt) / 1000);
			return {
				uptimeSeconds,
				activeQueues: ["events.high"],
				externalSystems: ["research-db"],
			};
		},
	};
}
