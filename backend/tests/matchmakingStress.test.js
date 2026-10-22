const matchmakingService = require("../services/matchmakingService");
const { MatchmakingService, MATCHMAKING_CONFIG } = matchmakingService;

describe("Concurrent Matchmaking Stress Test Suite (Issue #586)", () => {
	let service;

	beforeEach(() => {
		// Use a dedicated service instance per test for strict isolation
		service = new MatchmakingService();
	});

	afterEach(() => {
		if (service) {
			service.stopQueueWorker();
			service.clearQueue();
		}
	});

	/**
	 * Helper to generate 100 mock tickets distributed across brackets:
	 * - 40 players in 1200–1400 bracket (20 pairs)
	 * - 40 players in 1401–1600 bracket (20 pairs)
	 * - 20 players in 1800–2200 bracket (10 pairs)
	 */
	function generate100Tickets(options = {}) {
		const {
			wagerTier = "standard",
			wagerAsset = "XLM",
			timeControl = "5+0",
			differentiateSettings = false,
		} = options;

		const tickets = [];

		// 40 players in 1200–1400 bracket: 20 pairs with tight Elo diff (2 points apart)
		for (let i = 0; i < 20; i++) {
			const baseElo = 1200 + i * 10;
			const asset = differentiateSettings && i % 2 === 1 ? "USDC" : wagerAsset;
			const tc = differentiateSettings && i % 2 === 1 ? "3+0" : timeControl;

			tickets.push({
				userId: `user_1200_${i}_A`,
				socketId: `socket_1200_${i}_A`,
				elo: baseElo,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1200_${i}_A`,
			});
			tickets.push({
				userId: `user_1200_${i}_B`,
				socketId: `socket_1200_${i}_B`,
				elo: baseElo + 2,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1200_${i}_B`,
			});
		}

		// 40 players in 1401–1600 bracket: 20 pairs with tight Elo diff (2 points apart)
		for (let i = 0; i < 20; i++) {
			const baseElo = 1405 + i * 10;
			const asset = differentiateSettings && i % 2 === 1 ? "USDC" : wagerAsset;
			const tc = differentiateSettings && i % 2 === 1 ? "3+0" : timeControl;

			tickets.push({
				userId: `user_1400_${i}_A`,
				socketId: `socket_1400_${i}_A`,
				elo: baseElo,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1400_${i}_A`,
			});
			tickets.push({
				userId: `user_1400_${i}_B`,
				socketId: `socket_1400_${i}_B`,
				elo: baseElo + 2,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1400_${i}_B`,
			});
		}

		// 20 players in 1800–2200 bracket: 10 pairs with tight Elo diff (2 points apart)
		for (let i = 0; i < 10; i++) {
			const baseElo = 1800 + i * 40;
			const asset = differentiateSettings && i % 2 === 1 ? "USDC" : wagerAsset;
			const tc = differentiateSettings && i % 2 === 1 ? "3+0" : timeControl;

			tickets.push({
				userId: `user_1800_${i}_A`,
				socketId: `socket_1800_${i}_A`,
				elo: baseElo,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1800_${i}_A`,
			});
			tickets.push({
				userId: `user_1800_${i}_B`,
				socketId: `socket_1800_${i}_B`,
				elo: baseElo + 2,
				wagerTier,
				wagerAsset: asset,
				timeControl: tc,
				ticketId: `ticket_1800_${i}_B`,
			});
		}

		return tickets;
	}

	test("simulates 100 concurrent queue entrants forming exactly 50 matches without duplicate pairings", async () => {
		const tickets = generate100Tickets();
		expect(tickets).toHaveLength(100);

		// Concurrently enqueue all 100 entrants via Promise.all
		const startTime = Date.now();
		await Promise.all(tickets.map((ticket) => Promise.resolve(service.addToQueue(ticket))));

		expect(service.getQueueSize()).toBe(100);

		// Process queue and measure execution latency
		const processStart = Date.now();
		const matches = service.processQueue();
		const durationMs = Date.now() - processStart;

		// Assert execution speed < 1500ms
		expect(durationMs).toBeLessThan(1500);

		// Assert exactly 50 matches created
		expect(matches).toHaveLength(50);
		expect(service.getQueueSize()).toBe(0);

		// Assert no duplicate player in matches and strict invariants
		const pairedUsers = new Set();
		const seenMatchCodes = new Set();

		for (const match of matches) {
			// Match code uniqueness
			expect(match.matchCode).toBeDefined();
			expect(seenMatchCodes.has(match.matchCode)).toBe(false);
			seenMatchCodes.add(match.matchCode);

			const p1 = match.player1;
			const p2 = match.player2;

			// Distinct players in match
			expect(p1.userId).not.toBe(p2.userId);

			// Uniqueness across all active matches
			expect(pairedUsers.has(p1.userId)).toBe(false);
			expect(pairedUsers.has(p2.userId)).toBe(false);
			pairedUsers.add(p1.userId);
			pairedUsers.add(p2.userId);

			// Identical game settings
			expect(p1.wagerTier).toBe(p2.wagerTier);
			expect(p1.wagerAsset).toBe(p2.wagerAsset);
			expect(p1.timeControl).toBe(p2.timeControl);

			// Rating tolerance invariant
			const eloGap = Math.abs(p1.elo - p2.elo);
			expect(eloGap).toBeLessThanOrEqual(MATCHMAKING_CONFIG.MAX_RATING_GAP);
		}

		expect(pairedUsers.size).toBe(100);
	});

	test("enforces segregation across wager assets and time controls under 100-player load", async () => {
		// 50 players on XLM 5+0 and 50 players on USDC 3+0
		const tickets = generate100Tickets({ differentiateSettings: true });
		expect(tickets).toHaveLength(100);

		await Promise.all(tickets.map((t) => Promise.resolve(service.addToQueue(t))));

		const matches = service.processQueue();
		expect(matches).toHaveLength(50);

		for (const match of matches) {
			const { player1, player2 } = match;
			expect(player1.wagerAsset).toBe(player2.wagerAsset);
			expect(player1.timeControl).toBe(player2.timeControl);
		}
	});

	test("handles 100 concurrent entrants with 20 simultaneous cancellations", async () => {
		const tickets = generate100Tickets();

		// Enqueue all 100
		await Promise.all(tickets.map((t) => Promise.resolve(service.addToQueue(t))));
		expect(service.getQueueSize()).toBe(100);

		// Concurrently cancel 20 tickets
		const canceledTickets = tickets.slice(0, 20);
		await Promise.all(canceledTickets.map((t) => Promise.resolve(service.removeFromQueue(t.userId))));

		expect(service.getQueueSize()).toBe(80);

		// Process remaining
		const matches = service.processQueue();

		// Paired players + remaining in queue must equal 80
		const pairedPlayerCount = matches.length * 2;
		const remainingInQueue = service.getQueueSize();
		expect(pairedPlayerCount + remainingInQueue).toBe(80);

		// Assert none of the cancelled users are in matches
		const canceledUserIds = new Set(canceledTickets.map((t) => t.userId));
		for (const match of matches) {
			expect(canceledUserIds.has(match.player1.userId)).toBe(false);
			expect(canceledUserIds.has(match.player2.userId)).toBe(false);
		}
	});

	test("matching engine worker loop processes concurrent entrants cleanly without dangling timers", async () => {
		const tickets = generate100Tickets();
		const matchedBatches = [];

		service.startQueueWorker({
			intervalMs: 50,
			onMatch: (match) => {
				matchedBatches.push(match);
			},
		});

		// Enqueue 100 tickets concurrently while worker is active
		await Promise.all(tickets.map((t) => Promise.resolve(service.addToQueue(t))));

		// Wait for worker intervals to process the queue
		const deadline = Date.now() + 2000;
		while (service.getQueueSize() > 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		// Worker must stop cleanly
		service.stopQueueWorker();
		expect(service.pollTimer).toBeNull();

		// All 50 matches should have been delivered to onMatch
		expect(matchedBatches).toHaveLength(50);
		expect(service.getQueueSize()).toBe(0);

		// Verify zero duplicates across onMatch callbacks
		const players = new Set();
		for (const m of matchedBatches) {
			expect(players.has(m.player1.userId)).toBe(false);
			expect(players.has(m.player2.userId)).toBe(false);
			players.add(m.player1.userId);
			players.add(m.player2.userId);
		}
		expect(players.size).toBe(100);
	});

	test("handles rapid interleaving enqueue/dequeue without deadlocks or corruption", async () => {
		const operations = [];
		const total = 100;

		for (let i = 0; i < total; i++) {
			const ticket = {
				userId: `interleave_user_${i}`,
				socketId: `socket_${i}`,
				elo: 1200 + (i % 50) * 10,
				wagerTier: "standard",
			};

			if (i % 4 === 0) {
				// Enqueue and immediately cancel
				operations.push(
					Promise.resolve().then(() => {
						service.addToQueue(ticket);
						service.removeFromQueue(ticket.userId);
					})
				);
			} else {
				operations.push(Promise.resolve().then(() => service.addToQueue(ticket)));
			}
		}

		await Promise.all(operations);

		// Exactly 25 were cancelled, 75 remain
		expect(service.getQueueSize()).toBe(75);

		// Process queue without throwing
		const matches = service.processQueue();
		expect(Array.isArray(matches)).toBe(true);

		// Conservation check
		expect(matches.length * 2 + service.getQueueSize()).toBe(75);
	});
});
