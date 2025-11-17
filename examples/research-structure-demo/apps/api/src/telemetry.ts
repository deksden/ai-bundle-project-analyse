/**
 * Связка описывает зарегистрированный навигационный мост,
 * который сообщает об активности очередей.
 */
export interface NavigationMetric {
	name: string;
	totalEvents: number;
	lastEventAt: number | null;
	notes: string[];
}

export interface NavigationBridgeOptions {
	sampleRate?: number;
	onEvent?: (payload: string) => void;
}

const registeredBridges = new Map<string, NavigationMetric>();

/**
 * Регистрирует новый навигационный мост и возвращает метрики в реальном времени.
 */
export function registerNavigationBridge(
	name: string,
	options: NavigationBridgeOptions = {},
): NavigationMetric {
	if (!registeredBridges.has(name)) {
		registeredBridges.set(name, {
			name,
			totalEvents: 0,
			lastEventAt: null,
			notes: [`sampleRate=${options.sampleRate ?? 1}`],
		});
	}

	const metric = registeredBridges.get(name)!;
	metric.totalEvents += 1;
	metric.lastEventAt = Date.now();

	if (options.onEvent) {
		options.onEvent(`bridge:${name}:event:${metric.totalEvents}`);
		metric.notes.push("event-callback");
	}

	return metric;
}

/**
 * Формирует снапшот метрик и синхронизирует их с внешними системами.
 * Возвращает идентификатор выгрузки, который используется в логах docs lane.
 */
export function syncTelemetrySnapshot(
	metrics: NavigationMetric[],
	writeLog = true,
): string {
	const identifier = `snapshot-${Date.now()}`;
	if (writeLog) {
		console.info("[telemetry] sync", identifier, metrics.length);
	}
	for (const metric of metrics) {
		const stored = registeredBridges.get(metric.name) ?? metric;
		stored.totalEvents = Math.max(stored.totalEvents, metric.totalEvents);
		stored.lastEventAt = metric.lastEventAt ?? stored.lastEventAt;
		registeredBridges.set(metric.name, stored);
	}
	return identifier;
}
