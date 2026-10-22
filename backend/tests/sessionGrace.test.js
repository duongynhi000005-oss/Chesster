const { SessionService } = require("../services/sessionService");
const moveAuthority = require("../socket/moveAuthority");

// Mock dependencies
jest.mock("../models/gameModel", () => ({
	getGame: jest.fn(),
	updateGameResult: jest.fn(),
	forfeitByDisconnect: jest.fn(),
}));

jest.mock("../services/escrowService", () => ({
	resolveMatch: jest.fn().mockResolvedValue({ hash: "tx_mock_hash" }),
	forfeitMatch: jest.fn().mockResolvedValue({ hash: "tx_mock_hash" }),
	getMatch: jest.fn(),
}));

jest.mock("../models/userModel", () => ({
	invalidateProfilesForGame: jest.fn().mockResolvedValue(undefined),
}));

const gameModel = require("../models/gameModel");
const escrowService = require("../services/escrowService");

describe("SessionService Disconnection Grace & Auto-Forfeit Scheduler (Issue #580)", () => {
	let service;
	let mockIo;
	let emitMock;
	let toMock;

	const GAME_ID = "GAME_SESSION_580";
	const PLAYER_WHITE = "GWHITE_PLAYER_ADDR_123456789";
	const PLAYER_BLACK = "GBLACK_PLAYER_ADDR_987654321";

	beforeEach(() => {
		jest.useFakeTimers();
		emitMock = jest.fn();
		toMock = jest.fn().mockReturnValue({ emit: emitMock });
		mockIo = {
			to: toMock,
			emit: emitMock,
		};

		service = new SessionService();
		service.init(mockIo);
		service.resetLocalState();

		jest.clearAllMocks();
	});

	afterEach(() => {
		service.resetLocalState();
		jest.useRealTimers();
	});

	describe("startDisconnectionGrace", () => {
		it("starts a 60-second grace timer and emits OPPONENT_DISCONNECTED with remaining grace", () => {
			const entry = service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK);

			expect(entry).toBeDefined();
			expect(entry.gameId).toBe(GAME_ID);
			expect(entry.playerAddress).toBe(PLAYER_WHITE);
			expect(entry.opponentAddress).toBe(PLAYER_BLACK);
			expect(entry.graceDurationMs).toBe(60000);

			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(true);

			// Verify WebSocket event emission
			expect(mockIo.to).toHaveBeenCalledWith(GAME_ID);
			expect(emitMock).toHaveBeenCalledWith(
				"OPPONENT_DISCONNECTED",
				expect.objectContaining({
					gameId: GAME_ID,
					playerAddress: PLAYER_WHITE,
					opponentAddress: PLAYER_BLACK,
					gracePeriodRemainingMs: 60000,
				})
			);
		});

		it("returns remaining grace duration via getGraceRemainingMs", () => {
			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, null, 60000);

			expect(service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE)).toBe(60000);

			jest.advanceTimersByTime(25000);

			expect(service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE)).toBe(35000);
		});

		it("returns 0 remaining grace for non-existent disconnection timer", () => {
			expect(service.getGraceRemainingMs("NON_EXISTENT", "UNKNOWN_ADDR")).toBe(0);
		});

		it("returns null if gameId or playerAddress is missing", () => {
			expect(service.startDisconnectionGrace(null, PLAYER_WHITE, PLAYER_BLACK)).toBeNull();
			expect(service.startDisconnectionGrace(GAME_ID, null, PLAYER_BLACK)).toBeNull();
		});

		it("replaces existing timer if called again for the same player", () => {
			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, null, 60000);
			const firstRemaining = service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE);

			jest.advanceTimersByTime(20000);
			expect(service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE)).toBe(40000);

			// Start grace again, resetting countdown
			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, null, 60000);
			expect(service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE)).toBe(60000);
		});
	});

	describe("cancelDisconnectionGrace", () => {
		it("cancels active grace timer and emits OPPONENT_RECONNECTED", () => {
			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK);
			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(true);

			const cancelled = service.cancelDisconnectionGrace(GAME_ID, PLAYER_WHITE);
			expect(cancelled).toBe(true);
			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(false);

			// Verify OPPONENT_RECONNECTED event
			expect(mockIo.to).toHaveBeenCalledWith(GAME_ID);
			expect(emitMock).toHaveBeenCalledWith(
				"OPPONENT_RECONNECTED",
				expect.objectContaining({
					gameId: GAME_ID,
					playerAddress: PLAYER_WHITE,
				})
			);
		});

		it("returns false if no active timer exists to cancel", () => {
			const cancelled = service.cancelDisconnectionGrace(GAME_ID, "UNKNOWN_PLAYER");
			expect(cancelled).toBe(false);
		});

		it("prevents auto-forfeit if reconnected within grace window (e.g. 35s)", async () => {
			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, null, 60000);

			// Advance 35 seconds (player reconnects before 60s timeout)
			jest.advanceTimersByTime(35000);
			const cancelled = service.cancelDisconnectionGrace(GAME_ID, PLAYER_WHITE);
			expect(cancelled).toBe(true);

			// Advance past original 60s expiry
			jest.advanceTimersByTime(30000);
			await Promise.resolve();

			expect(gameModel.updateGameResult).not.toHaveBeenCalled();
			expect(escrowService.resolveMatch).not.toHaveBeenCalled();
		});
	});

	describe("Auto-Forfeit Execution on Expiry", () => {
		it("triggers auto-forfeit due to abandonment and notifies escrow on timer expiry (60s)", async () => {
			gameModel.updateGameResult.mockResolvedValue({
				game_code: GAME_ID,
				status: "finished",
				winner: "black",
				end_reason: "abandonment",
			});

			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, null, 60000);

			// Advance timers past 60s grace duration
			await jest.advanceTimersByTimeAsync(60001);
			await Promise.resolve(); // Flush microtasks

			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(false);

			// Verify gameModel.updateGameResult was invoked with abandonment
			expect(gameModel.updateGameResult).toHaveBeenCalledWith(GAME_ID, {
				winner: PLAYER_BLACK,
				reason: "abandonment",
			});

			// Verify escrowService was informed to resolve match for opponent
			expect(escrowService.resolveMatch).toHaveBeenCalledWith(GAME_ID, PLAYER_BLACK);

			// Verify game_over event was emitted
			expect(emitMock).toHaveBeenCalledWith(
				"game_over",
				expect.objectContaining({
					gameCode: GAME_ID,
					winner: PLAYER_BLACK,
					reason: "abandonment",
				})
			);
		});

		it("invokes custom onTimeout callback if provided", async () => {
			const onTimeoutCallback = jest.fn().mockResolvedValue(true);

			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK, onTimeoutCallback, 10000);

			await jest.advanceTimersByTimeAsync(10001);
			await Promise.resolve();

			expect(onTimeoutCallback).toHaveBeenCalledTimes(1);
			expect(gameModel.updateGameResult).not.toHaveBeenCalled(); // Custom callback takes precedence
		});
	});

	describe("Concurrent multi-game isolation", () => {
		it("tracks multiple disconnected players across games independently", () => {
			const GAME_1 = "GAME_1";
			const GAME_2 = "GAME_2";
			const PLAYER_A = "GPLAYER_A";
			const PLAYER_B = "GPLAYER_B";
			const PLAYER_C = "GPLAYER_C";
			const PLAYER_D = "GPLAYER_D";

			service.startDisconnectionGrace(GAME_1, PLAYER_A, PLAYER_B, null, 60000);
			service.startDisconnectionGrace(GAME_2, PLAYER_C, PLAYER_D, null, 45000);

			expect(service.isPendingDisconnection(GAME_1, PLAYER_A)).toBe(true);
			expect(service.isPendingDisconnection(GAME_2, PLAYER_C)).toBe(true);

			// Reconnect player in GAME_1
			service.cancelDisconnectionGrace(GAME_1, PLAYER_A);
			expect(service.isPendingDisconnection(GAME_1, PLAYER_A)).toBe(false);
			expect(service.isPendingDisconnection(GAME_2, PLAYER_C)).toBe(true);

			// Clear all local state
			service.resetLocalState();
			expect(service.isPendingDisconnection(GAME_2, PLAYER_C)).toBe(false);
		});
	});

	describe("moveAuthority integration", () => {
		it("handleDisconnect starts grace when sessionService is in deps and game is active", async () => {
			gameModel.getGame.mockResolvedValue({
				game_code: GAME_ID,
				status: "active",
				player_white_address: PLAYER_WHITE,
				player_black_address: PLAYER_BLACK,
			});

			const result = await moveAuthority.handleDisconnect(
				{ gameModel, sessionService: service },
				GAME_ID,
				"white"
			);

			expect(result.shouldStartGrace).toBe(true);
			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(true);
			expect(service.getGraceRemainingMs(GAME_ID, PLAYER_WHITE)).toBeGreaterThan(0);
		});

		it("handleReconnect cancels session grace and timer grace on reconnect", async () => {
			gameModel.getGame.mockResolvedValue({
				game_code: GAME_ID,
				status: "active",
				player_white_address: PLAYER_WHITE,
				player_black_address: PLAYER_BLACK,
			});

			service.startDisconnectionGrace(GAME_ID, PLAYER_WHITE, PLAYER_BLACK);
			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(true);

			const mockTimerService = { cancelReconnectGrace: jest.fn() };

			const result = await moveAuthority.handleReconnect(
				{ gameModel, timerService: mockTimerService, sessionService: service },
				GAME_ID,
				PLAYER_WHITE
			);

			expect(result.ok).toBe(true);
			expect(result.playerColor).toBe("white");
			expect(mockTimerService.cancelReconnectGrace).toHaveBeenCalledWith(GAME_ID, "white");
			expect(service.isPendingDisconnection(GAME_ID, PLAYER_WHITE)).toBe(false);
		});
	});
});
