export interface CleanupJobConfig {
	table: string;
	ttlHours: number;
}

export async function runCleanupJob(config: CleanupJobConfig): Promise<number> {
	console.warn(`[cron] running cleanup for table=${config.table}`);
	// Для демо возвращаем фиксированное количество удалённых записей.
	return Math.max(1, Math.floor(config.ttlHours / 6));
}
