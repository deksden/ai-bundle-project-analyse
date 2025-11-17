interface AggregatedMetric {
	key: string;
	value: number;
}

export function aggregateMetrics(samples: Array<Record<string, number>>): AggregatedMetric[] {
	const result = new Map<string, number>();

	for (const sample of samples) {
		for (const [key, value] of Object.entries(sample)) {
			result.set(key, (result.get(key) ?? 0) + value);
		}
	}

	return Array.from(result.entries())
		.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
		.map(([key, value]) => ({ key, value }));
}
