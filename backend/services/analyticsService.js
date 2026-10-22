const supabase = require("../config/supabase");

/**
 * Get the count of unique active players for a given date.
 * A player is considered active if they were player_white or player_black
 * in a game that existed on that date.
 */
async function getDailyActivePlayers(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: whitePlayers, error: whiteError } = await supabase
			.from("games")
			.select("player_white_address")
			.not("player_white_address", "is", null)
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (whiteError) throw whiteError;

		const { data: blackPlayers, error: blackError } = await supabase
			.from("games")
			.select("player_black_address")
			.not("player_black_address", "is", null)
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (blackError) throw blackError;

		const wallets = new Set();
		for (const row of whitePlayers || []) {
			if (row.player_white_address) wallets.add(row.player_white_address);
		}
		for (const row of blackPlayers || []) {
			if (row.player_black_address) wallets.add(row.player_black_address);
		}

		return { date: startOfDay.toISOString().split("T")[0], activePlayers: wallets.size };
	} catch (error) {
		console.error("[AnalyticsService] Error fetching daily active players:", error.message);
		throw error;
	}
}

/**
 * Get match volume stats for a given date: total matches, completed, wins, draws.
 */
async function getDailyMatchVolume(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("status, winner")
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString());

		if (error) throw error;

		const all = matches || [];
		const completed = all.filter((m) => m.status === "completed");
		const draws = completed.filter((m) => !m.winner || m.winner === null);
		const wins = completed.filter((m) => m.winner && m.winner !== null);

		return {
			date: startOfDay.toISOString().split("T")[0],
			totalMatches: all.length,
			completedMatches: completed.length,
			wins: wins.length,
			draws: draws.length,
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching daily match volume:", error.message);
		throw error;
	}
}

/**
 * Get total tokens wagered for a given date.
 */
async function getTokenWageredSummary(date) {
	try {
		const startOfDay = new Date(date);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(date);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("wager_amount, status")
			.gte("created_at", startOfDay.toISOString())
			.lte("created_at", endOfDay.toISOString())
			.not("wager_amount", "is", null);

		if (error) throw error;

		const all = matches || [];
		let totalWagered = 0;
		let completedWagered = 0;

		for (const match of all) {
			const amount = parseFloat(match.wager_amount) || 0;
			totalWagered += amount;
			if (match.status === "completed") {
				completedWagered += amount;
			}
		}

		return {
			date: startOfDay.toISOString().split("T")[0],
			totalWagered: totalWagered.toFixed(7),
			completedWagered: completedWagered.toFixed(7),
			matchesWithWager: all.length,
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching token wagered summary:", error.message);
		throw error;
	}
}

/**
 * Get a combined dashboard summary for a date range.
 * If dateRange is not provided, defaults to the last 7 days.
 */
async function getDashboardSummary(dateRange = null) {
	try {
		const end = dateRange?.end ? new Date(dateRange.end) : new Date();
		const start = dateRange?.start
			? new Date(dateRange.start)
			: new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

		start.setUTCHours(0, 0, 0, 0);
		end.setUTCHours(23, 59, 59, 999);

		const { data: matches, error } = await supabase
			.from("games")
			.select("status, winner, wager_amount, player_white_address, player_black_address, created_at")
			.gte("created_at", start.toISOString())
			.lte("created_at", end.toISOString());

		if (error) throw error;

		const all = matches || [];
		const wallets = new Set();
		let totalWagered = 0;
		let completedMatches = 0;
		let wins = 0;
		let draws = 0;

		for (const match of all) {
			if (match.player_white_address) wallets.add(match.player_white_address);
			if (match.player_black_address) wallets.add(match.player_black_address);

			const amount = parseFloat(match.wager_amount) || 0;
			totalWagered += amount;

			if (match.status === "completed") {
				completedMatches++;
				if (match.winner) wins++;
				else draws++;
			}
		}

		return {
			startDate: start.toISOString().split("T")[0],
			endDate: end.toISOString().split("T")[0],
			totalMatches: all.length,
			completedMatches,
			wins,
			draws,
			activePlayers: wallets.size,
			totalWagered: totalWagered.toFixed(7),
		};
	} catch (error) {
		console.error("[AnalyticsService] Error fetching dashboard summary:", error.message);
		throw error;
	}
}

/**
 * Aggregate hourly platform metrics from games table and store in hourly_platform_metrics.
 * This function is idempotent: calling it multiple times for the same hour will not create duplicates.
 *
 * Computes:
 * - total_matches: count of all games created in the hour
 * - completed_matches: count of games with status='completed'
 * - total_wager_xlm: sum of wager_amount for games (assumes XLM token)
 * - total_wager_usdc: sum of wager_amount for games (filtered by token_address, assumes USDC token)
 * - unique_players: count of distinct wallet addresses (player_white_address or player_black_address)
 *
 * @param {Date|string} targetHour - The hour to aggregate. Can be a Date object or ISO string.
 *                                   The function will truncate to the hour boundary (e.g., 14:00:00).
 * @returns {object} Result object with aggregation stats: { bucketStart, rowsInserted, aggregatedMetrics }
 * @throws {Error} If database query or upsert fails
 */
async function aggregateHourlyMetrics(targetHour) {
	try {
		// Normalize input and truncate to hour boundary
		const hourDate = new Date(targetHour);
		hourDate.setUTCMinutes(0, 0, 0);
		const bucketStart = hourDate.toISOString();
		const bucketEnd = new Date(hourDate.getTime() + 60 * 60 * 1000).toISOString();

		// Query all games created within this hour
		const { data: games, error: gamesError } = await supabase
			.from("games")
			.select("status, winner, wager_amount, token_address, player_white_address, player_black_address")
			.gte("created_at", bucketStart)
			.lt("created_at", bucketEnd);

		if (gamesError) throw gamesError;

		const gamesList = games || [];
		const wallets = new Set();
		let totalMatches = 0;
		let completedMatches = 0;
		let totalWagerXlm = 0;
		let totalWagerUsdc = 0;

		// Process games and aggregate metrics
		for (const game of gamesList) {
			totalMatches++;

			// Collect unique players
			if (game.player_white_address) wallets.add(game.player_white_address);
			if (game.player_black_address) wallets.add(game.player_black_address);

			// Count completed matches
			if (game.status === "completed") {
				completedMatches++;
			}

			// Aggregate wager amounts by token type
			const wagerAmount = parseFloat(game.wager_amount) || 0;
			if (wagerAmount > 0) {
				// Determine token type from token_address if available, otherwise assume XLM
				// This can be enhanced with token type detection if token_address is provided
				if (game.token_address && game.token_address.toLowerCase().includes("usdc")) {
					totalWagerUsdc += wagerAmount;
				} else {
					totalWagerXlm += wagerAmount;
				}
			}
		}

		// Upsert metrics into hourly_platform_metrics table
		// ON CONFLICT on bucket_start, update the metrics (idempotent)
		const { data: upsertResult, error: upsertError } = await supabase
			.from("hourly_platform_metrics")
			.upsert(
				{
					bucket_start: bucketStart,
					total_matches: totalMatches,
					completed_matches: completedMatches,
					total_wager_xlm: totalWagerXlm.toFixed(7),
					total_wager_usdc: totalWagerUsdc.toFixed(2),
					unique_players: wallets.size,
				},
				{
					onConflict: "bucket_start",
				}
			)
			.select();

		if (upsertError) throw upsertError;

		console.log(
			`[AnalyticsService] Aggregated hourly metrics for ${bucketStart}: ` +
				`${totalMatches} matches, ${completedMatches} completed, ` +
				`${wallets.size} unique players, XLM: ${totalWagerXlm.toFixed(7)}, USDC: ${totalWagerUsdc.toFixed(2)}`
		);

		return {
			bucketStart,
			rowsInserted: upsertResult?.length || 1,
			aggregatedMetrics: {
				totalMatches,
				completedMatches,
				uniquePlayers: wallets.size,
				totalWagerXlm: parseFloat(totalWagerXlm.toFixed(7)),
				totalWagerUsdc: parseFloat(totalWagerUsdc.toFixed(2)),
			},
		};
	} catch (error) {
		console.error("[AnalyticsService] Error aggregating hourly metrics:", error.message);
		throw error;
	}
}

// 5-minute cache TTL in milliseconds (Issue #582)
const VOLUME_CACHE_TTL_MS = 5 * 60 * 1000;
let volumeCache = {
	data: null,
	cachedAt: 0,
};

function clearVolumeCache() {
	volumeCache = { data: null, cachedAt: 0 };
}

/**
 * Standardize token asset symbols based on token_address or currency code.
 */
function resolveAssetSymbol(tokenAddress) {
	if (!tokenAddress || typeof tokenAddress !== "string") return "XLM";
	const lower = tokenAddress.toLowerCase().trim();
	if (lower.includes("usdc") || lower.includes("circle")) return "USDC";
	if (lower.includes("eurc")) return "EURC";
	if (lower === "xlm" || lower === "native") return "XLM";
	return tokenAddress.toUpperCase();
}

/**
 * Aggregate rolling 24-hour liquidity and wager volume by asset (Issue #582).
 *
 * Queries games created in the last 24 hours, aggregates metrics segmented
 * by token asset, and caches the response for 5 minutes.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.bypassCache=false]
 * @param {Date|number} [options.now=Date.now()]
 * @returns {Promise<{ window: string, timestamp: string, assets: Array<object> }>}
 */
async function getRolling24HourVolume(options = {}) {
	const now = options.now ? new Date(options.now).getTime() : Date.now();

	// Check 5-minute cache
	if (!options.bypassCache && volumeCache.data && now - volumeCache.cachedAt < VOLUME_CACHE_TTL_MS) {
		return {
			...volumeCache.data,
			_cached: true,
		};
	}

	const windowStart = new Date(now - 24 * 60 * 60 * 1000).toISOString();
	const windowEnd = new Date(now).toISOString();

	const { data: games, error } = await supabase
		.from("games")
		.select("status, winner, wager_amount, token_address, player_white_address, player_black_address, created_at")
		.gte("created_at", windowStart)
		.lte("created_at", windowEnd);

	if (error) {
		console.error("[AnalyticsService] Error fetching rolling 24h games:", error.message);
		throw error;
	}

	const gamesList = games || [];

	// Map of asset -> { totalVolume: number, matchCount: number, players: Set<string> }
	const assetAggregates = new Map();

	for (const game of gamesList) {
		const asset = resolveAssetSymbol(game.token_address);
		if (!assetAggregates.has(asset)) {
			assetAggregates.set(asset, {
				asset,
				totalVolume: 0,
				matchCount: 0,
				players: new Set(),
			});
		}

		const entry = assetAggregates.get(asset);
		entry.matchCount++;

		const wager = parseFloat(game.wager_amount) || 0;
		entry.totalVolume += wager;

		if (game.player_white_address) entry.players.add(game.player_white_address);
		if (game.player_black_address) entry.players.add(game.player_black_address);
	}

	const assets = [];
	for (const [asset, entry] of assetAggregates.entries()) {
		const avgWager = entry.matchCount > 0 ? entry.totalVolume / entry.matchCount : 0;
		assets.push({
			asset,
			totalVolume: entry.totalVolume.toFixed(2),
			matchCount: entry.matchCount,
			uniquePlayers: entry.players.size,
			averageWager: avgWager.toFixed(2),
		});
	}

	// Sort assets descending by totalVolume
	assets.sort((a, b) => parseFloat(b.totalVolume) - parseFloat(a.totalVolume));

	const response = {
		window: "24h",
		timestamp: windowEnd,
		assets,
	};

	// Store in cache
	volumeCache = {
		data: response,
		cachedAt: now,
	};

	return response;
}

module.exports = {
	getDailyActivePlayers,
	getDailyMatchVolume,
	getTokenWageredSummary,
	getDashboardSummary,
	aggregateHourlyMetrics,
	getRolling24HourVolume,
	resolveAssetSymbol,
	clearVolumeCache,
	VOLUME_CACHE_TTL_MS,
};
