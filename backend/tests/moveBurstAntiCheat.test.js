jest.mock("../config/supabase", () => ({}));
jest.mock("../models/gameModel", () => ({ recordCheatAnalysis: jest.fn() }));
jest.mock("../services/botService", () => ({
  analyzeFen: jest.fn(),
  boardToFEN: jest.fn(() => "test-fen"),
}));

const {
  authorizeMove,
  validateMoveTiming,
  recordOpponentMoveTimestamp,
  getLastOpponentMoveTimestamp,
  registerPremove,
  getPremove,
  consumePremove,
  clearPremove,
  clearGameTimingState,
  BURST_THRESHOLD_MS,
  MIN_PREMOVE_DURATION_MS,
} = require("../socket/moveAuthority");
const antiCheatService = require("../services/antiCheatService");

describe("Issue #583: Detect Illegal Move Timing Bursts During Premove Execution", () => {
  const gameCode = "GAME_BURST_TEST_583";
  const whiteAddress = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFDAGOROTU2W45DEGKOOX";
  const blackAddress = "GCKZWNGUJW7H4572242U376SSQWUSZ7G2KGXGZ72D57L2H7GZ6TGYO6H";

  const createMockGame = (currentTurn = "white", status = "active") => ({
    id: gameCode,
    game_code: gameCode,
    status,
    current_turn: currentTurn,
    player_white_address: whiteAddress,
    player_black_address: blackAddress,
  });

  let mockAntiCheat;

  beforeEach(() => {
    clearGameTimingState(gameCode);
    mockAntiCheat = {
      logBurstAttempt: jest.fn().mockResolvedValue({ logged: true }),
    };
  });

  afterEach(() => {
    clearGameTimingState(gameCode);
  });

  // -------------------------------------------------------------------------
  // 1. Core Timing & Rate Clamp Validation
  // -------------------------------------------------------------------------
  describe("Move timing and burst clamping", () => {
    it("accepts first move of the game when no opponent move has occurred", () => {
      const game = createMockGame("white");
      const result = authorizeMove(game, "white", {
        submissionTimestamp: 1000,
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(true);
      expect(mockAntiCheat.logBurstAttempt).not.toHaveBeenCalled();
    });

    it("accepts move when elapsed time from last opponent move is >= 40ms", () => {
      const game = createMockGame("white");
      recordOpponentMoveTimestamp(gameCode, 1000);

      const result = authorizeMove(game, "white", {
        submissionTimestamp: 1050, // delta = 50ms >= 40ms
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(true);
      expect(mockAntiCheat.logBurstAttempt).not.toHaveBeenCalled();
    });

    it("rejects non-premove move submission under 40ms with RATE_LIMITED_MOVE_BURST", () => {
      const game = createMockGame("white");
      recordOpponentMoveTimestamp(gameCode, 1000);

      const result = authorizeMove(game, "white", {
        submissionTimestamp: 1025, // delta = 25ms < 40ms
        clientIp: "192.168.1.100",
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("RATE_LIMITED_MOVE_BURST");
      expect(result.message).toMatch(/exceeds allowable burst threshold/);
      expect(result.deltaMs).toBe(25);

      expect(mockAntiCheat.logBurstAttempt).toHaveBeenCalledTimes(1);
      expect(mockAntiCheat.logBurstAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          gameCode,
          playerAddress: whiteAddress,
          clientIp: "192.168.1.100",
          deltaMs: 25,
          reason: "RATE_LIMITED_MOVE_BURST",
        })
      );
    });

    it("rejects extreme rapid bursts (<10ms apart)", () => {
      const game = createMockGame("black");
      recordOpponentMoveTimestamp(gameCode, 5000);

      const result = authorizeMove(game, "black", {
        submissionTimestamp: 5005, // delta = 5ms
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("RATE_LIMITED_MOVE_BURST");
      expect(result.deltaMs).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Legitimate vs Forged Premove Verification
  // -------------------------------------------------------------------------
  describe("Premove verification and clamping", () => {
    it("accepts legitimate premove registered before opponent move landed", () => {
      const game = createMockGame("white");
      const opponentMoveTime = 2000;
      const premoveRegistrationTime = 1900; // Queued 100ms before opponent moved
      const submissionTime = 2005; // Lands 5ms after opponent moved

      recordOpponentMoveTimestamp(gameCode, opponentMoveTime);

      const result = authorizeMove(game, "white", {
        isPremove: true,
        premoveRegistrationTimestamp: premoveRegistrationTime,
        submissionTimestamp: submissionTime,
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(true);
      expect(result.isPremove).toBe(true);
      // Turn duration clamped to minimum 10ms
      expect(result.clampedDurationMs).toBeGreaterThanOrEqual(MIN_PREMOVE_DURATION_MS);
      expect(mockAntiCheat.logBurstAttempt).not.toHaveBeenCalled();
    });

    it("clamps turn duration to minimum 10ms when premove delta is very small", () => {
      const game = createMockGame("white");
      recordOpponentMoveTimestamp(gameCode, 2000);

      const result = authorizeMove(game, "white", {
        isPremove: true,
        premoveRegistrationTimestamp: 1950,
        submissionTimestamp: 2002, // delta = 2ms
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(true);
      expect(result.clampedDurationMs).toBe(10);
    });

    it("rejects forged premove when registration timestamp is AFTER opponent move landed", () => {
      const game = createMockGame("white");
      const opponentMoveTime = 2000;
      const forgedRegistrationTime = 2005; // Forged: registered after opponent moved
      const submissionTime = 2010;

      recordOpponentMoveTimestamp(gameCode, opponentMoveTime);

      const result = authorizeMove(game, "white", {
        isPremove: true,
        premoveRegistrationTimestamp: forgedRegistrationTime,
        submissionTimestamp: submissionTime,
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("RATE_LIMITED_MOVE_BURST");
      expect(result.message).toMatch(/premove registration timestamp invalid or after opponent move/);

      expect(mockAntiCheat.logBurstAttempt).toHaveBeenCalledTimes(1);
      expect(mockAntiCheat.logBurstAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          gameCode,
          playerAddress: whiteAddress,
          reason: "INVALID_PREMOVE_BURST",
        })
      );
    });

    it("rejects premove flagged without valid registration timestamp", () => {
      const game = createMockGame("white");
      recordOpponentMoveTimestamp(gameCode, 2000);

      const result = authorizeMove(game, "white", {
        isPremove: true,
        premoveRegistrationTimestamp: null,
        submissionTimestamp: 2015,
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("RATE_LIMITED_MOVE_BURST");
      expect(mockAntiCheat.logBurstAttempt).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Server-side Premove Queue Management
  // -------------------------------------------------------------------------
  describe("Server-side premove queue operations", () => {
    it("registers, retrieves, and consumes a pending premove", () => {
      const regTime = 1000;
      const premoveData = { from: "e2", to: "e4", promotion: null };

      const stored = registerPremove(gameCode, "white", premoveData, regTime);
      expect(stored).toEqual(
        expect.objectContaining({
          from: "e2",
          to: "e4",
          registrationTimestamp: regTime,
        })
      );

      expect(getPremove(gameCode, "white")).toEqual(stored);

      const consumed = consumePremove(gameCode, "white");
      expect(consumed).toEqual(stored);

      // Subsequent read should be null after consume
      expect(getPremove(gameCode, "white")).toBeNull();
    });

    it("automatically recognizes stored server-side premoves during authorization", () => {
      const game = createMockGame("white");
      const opponentMoveTime = 2000;
      const regTime = 1900; // registered before opponent moved

      registerPremove(gameCode, "white", { from: "d2", to: "d4" }, regTime);
      recordOpponentMoveTimestamp(gameCode, opponentMoveTime);

      // Submission without explicitly passing isPremove: should look up stored premove
      const result = authorizeMove(game, "white", {
        submissionTimestamp: 2008,
        antiCheatService: mockAntiCheat,
      });

      expect(result.ok).toBe(true);
      expect(result.isPremove).toBe(true);
      expect(result.clampedDurationMs).toBe(10);
    });

    it("clears premoves and timing state on clearGameTimingState", () => {
      registerPremove(gameCode, "white", { from: "e2", to: "e4" });
      recordOpponentMoveTimestamp(gameCode, 1500);

      clearGameTimingState(gameCode);

      expect(getPremove(gameCode, "white")).toBeNull();
      expect(getLastOpponentMoveTimestamp(gameCode)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. AntiCheatService Telemetry Integration
  // -------------------------------------------------------------------------
  describe("AntiCheatService logBurstAttempt telemetry", () => {
    it("successfully writes burst anomaly record to anti_cheat_logs", async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
      const mockDb = { from: mockFrom };

      const service = new antiCheatService.AntiCheatService({ db: mockDb });

      const logResult = await service.logBurstAttempt({
        gameId: "GAME_123",
        gameCode: "GAME_123",
        playerAddress: "G_PLAYER_BURST",
        clientIp: "203.0.113.42",
        deltaMs: 14,
        move: { from: "e7", to: "e5" },
        reason: "RATE_LIMITED_MOVE_BURST",
      });

      expect(logResult.logged).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith("anti_cheat_logs");
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          game_id: "GAME_123",
          player_address: "G_PLAYER_BURST",
          client_ip: "203.0.113.42",
          delta_ms: 14,
          reason: "RATE_LIMITED_MOVE_BURST",
          severity: "high",
        })
      );
    });

    it("gracefully catches and logs errors when database write fails", async () => {
      const mockInsert = jest.fn().mockRejectedValue(new Error("DB connection timeout"));
      const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
      const mockDb = { from: mockFrom };
      const mockLogger = { warn: jest.fn() };

      const service = new antiCheatService.AntiCheatService({ db: mockDb, logger: mockLogger });

      const logResult = await service.logBurstAttempt({
        gameId: "GAME_123",
        deltaMs: 10,
      });

      expect(logResult.logged).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Exception writing to anti_cheat_logs")
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. Bot Exploit & Rapid Burst Simulation
  // -------------------------------------------------------------------------
  describe("Bot Exploit Simulation: Rapid Move Bursts", () => {
    it("blocks a scripted engine attempting sequential burst spam", () => {
      const game = createMockGame("white");
      const t0 = 10000;
      recordOpponentMoveTimestamp(gameCode, t0);

      // Move 1: Attempted at T + 5ms (Script trying to play immediately)
      const move1 = authorizeMove(game, "white", {
        submissionTimestamp: t0 + 5,
        antiCheatService: mockAntiCheat,
      });
      expect(move1.ok).toBe(false);
      expect(move1.code).toBe("RATE_LIMITED_MOVE_BURST");

      // Move 2: Attempted at T + 15ms (Script retrying)
      const move2 = authorizeMove(game, "white", {
        submissionTimestamp: t0 + 15,
        antiCheatService: mockAntiCheat,
      });
      expect(move2.ok).toBe(false);
      expect(move2.code).toBe("RATE_LIMITED_MOVE_BURST");

      // Move 3: Script waits till threshold passes (T + 45ms) -> Accepted
      const move3 = authorizeMove(game, "white", {
        submissionTimestamp: t0 + 45,
        antiCheatService: mockAntiCheat,
      });
      expect(move3.ok).toBe(true);
    });
  });
});
