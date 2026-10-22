jest.mock("../config/supabase");
jest.mock("../models/gameModel", () => ({}));
jest.mock("../services/escrowService", () => ({}));
jest.mock("../services/botService", () => ({}));

const request = require("supertest");
const express = require("express");
const supabase = require("../config/supabase");
const {
  getRolling24HourVolume,
  resolveAssetSymbol,
  clearVolumeCache,
  VOLUME_CACHE_TTL_MS,
} = require("../services/analyticsService");
const gameRoutes = require("../routes/gameRoutes");

describe("Issue #582: Rolling 24-Hour Liquidity & Wager Volume by Asset", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearVolumeCache();
  });

  afterEach(() => {
    clearVolumeCache();
  });

  // -------------------------------------------------------------------------
  // 1. Asset Symbol Resolution Unit Tests
  // -------------------------------------------------------------------------
  describe("resolveAssetSymbol", () => {
    it("resolves null, undefined, or empty token_address as XLM", () => {
      expect(resolveAssetSymbol(null)).toBe("XLM");
      expect(resolveAssetSymbol(undefined)).toBe("XLM");
      expect(resolveAssetSymbol("")).toBe("XLM");
    });

    it("identifies USDC tokens correctly", () => {
      expect(resolveAssetSymbol("USDC")).toBe("USDC");
      expect(resolveAssetSymbol("usdc")).toBe("USDC");
      expect(resolveAssetSymbol("CA_USDC_CONTRACT_ADDRESS")).toBe("USDC");
      expect(resolveAssetSymbol("circle_usdc_mainnet")).toBe("USDC");
    });

    it("identifies EURC tokens correctly", () => {
      expect(resolveAssetSymbol("EURC")).toBe("EURC");
      expect(resolveAssetSymbol("eurc_contract")).toBe("EURC");
    });

    it("uppercases unknown asset contract symbols", () => {
      expect(resolveAssetSymbol("aqua")).toBe("AQUA");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Volume Aggregation Logic
  // -------------------------------------------------------------------------
  describe("getRolling24HourVolume aggregation", () => {
    const fixedNow = new Date("2026-10-17T12:00:00.000Z");

    it("aggregates rolling 24-hour matches segmented by asset (USDC, XLM, EURC)", async () => {
      const mockGames = [
        // 2 USDC matches with 3 unique players
        {
          token_address: "USDC",
          wager_amount: "5000.00",
          player_white_address: "walletA",
          player_black_address: "walletB",
        },
        {
          token_address: "USDC",
          wager_amount: "9250.00",
          player_white_address: "walletB",
          player_black_address: "walletC",
        },
        // 1 XLM match with 2 unique players
        {
          token_address: null, // native XLM
          wager_amount: "1500.50",
          player_white_address: "walletA",
          player_black_address: "walletD",
        },
        // 1 EURC match
        {
          token_address: "EURC",
          wager_amount: "750.00",
          player_white_address: "walletE",
          player_black_address: "walletF",
        },
      ];

      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
          }),
        }),
      });

      const result = await getRolling24HourVolume({ now: fixedNow, bypassCache: true });

      expect(result.window).toBe("24h");
      expect(result.timestamp).toBe(fixedNow.toISOString());
      expect(result.assets).toHaveLength(3);

      // Ranked by totalVolume descending: USDC (14250.00) > XLM (1500.50) > EURC (750.00)
      const usdc = result.assets.find((a) => a.asset === "USDC");
      expect(usdc).toEqual({
        asset: "USDC",
        totalVolume: "14250.00",
        matchCount: 2,
        uniquePlayers: 3, // walletA, walletB, walletC
        averageWager: "7125.00",
      });

      const xlm = result.assets.find((a) => a.asset === "XLM");
      expect(xlm).toEqual({
        asset: "XLM",
        totalVolume: "1500.50",
        matchCount: 1,
        uniquePlayers: 2, // walletA, walletD
        averageWager: "1500.50",
      });

      const eurc = result.assets.find((a) => a.asset === "EURC");
      expect(eurc).toEqual({
        asset: "EURC",
        totalVolume: "750.00",
        matchCount: 1,
        uniquePlayers: 2,
        averageWager: "750.00",
      });
    });

    it("returns empty assets array when no matches exist in the 24-hour window", async () => {
      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await getRolling24HourVolume({ now: fixedNow, bypassCache: true });

      expect(result.window).toBe("24h");
      expect(result.assets).toEqual([]);
    });

    it("propagates database errors cleanly", async () => {
      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({ data: null, error: new Error("DB timeout") }),
          }),
        }),
      });

      await expect(getRolling24HourVolume({ bypassCache: true })).rejects.toThrow("DB timeout");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Cache TTL Verification
  // -------------------------------------------------------------------------
  describe("5-minute caching behavior", () => {
    it("returns cached response on repeated calls within 5 minutes without querying DB again", async () => {
      const mockGames = [
        {
          token_address: "USDC",
          wager_amount: "100.00",
          player_white_address: "w1",
          player_black_address: "w2",
        },
      ];

      const lteMock = jest.fn().mockResolvedValue({ data: mockGames, error: null });
      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({ lte: lteMock }),
        }),
      });

      const t0 = 1000000;
      // First call: cache miss, hits DB
      const res1 = await getRolling24HourVolume({ now: t0 });
      expect(res1.assets[0].totalVolume).toBe("100.00");
      expect(lteMock).toHaveBeenCalledTimes(1);

      // Second call: 2 minutes later (within 5-min TTL) -> served from cache
      const res2 = await getRolling24HourVolume({ now: t0 + 2 * 60 * 1000 });
      expect(res2._cached).toBe(true);
      expect(res2.assets[0].totalVolume).toBe("100.00");
      expect(lteMock).toHaveBeenCalledTimes(1); // Not called again!

      // Third call: 6 minutes later (expired) -> cache miss, re-queries DB
      const res3 = await getRolling24HourVolume({ now: t0 + 6 * 60 * 1000 });
      expect(res3._cached).toBeUndefined();
      expect(lteMock).toHaveBeenCalledTimes(2); // Called again!
    });

    it("bypasses cache when bypassCache option is true", async () => {
      const lteMock = jest.fn().mockResolvedValue({ data: [], error: null });
      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({ lte: lteMock }),
        }),
      });

      const t0 = 1000000;
      await getRolling24HourVolume({ now: t0 });
      expect(lteMock).toHaveBeenCalledTimes(1);

      await getRolling24HourVolume({ now: t0 + 1000, bypassCache: true });
      expect(lteMock).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. HTTP Endpoint Integration (GET /api/analytics/volume-24h)
  // -------------------------------------------------------------------------
  describe("GET /api/analytics/volume-24h route integration", () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use("/api", gameRoutes);
    });

    it("returns HTTP 200 with aggregated rolling 24-hour volume JSON", async () => {
      const mockGames = [
        {
          token_address: "USDC",
          wager_amount: "14250.00",
          player_white_address: "wA",
          player_black_address: "wB",
        },
        {
          token_address: "USDC",
          wager_amount: "750.00",
          player_white_address: "wB",
          player_black_address: "wC",
        },
      ];

      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({ data: mockGames, error: null }),
          }),
        }),
      });

      const res = await request(app).get("/api/analytics/volume-24h");

      expect(res.status).toBe(200);
      expect(res.body.window).toBe("24h");
      expect(res.body.timestamp).toBeDefined();
      expect(Array.isArray(res.body.assets)).toBe(true);
      expect(res.body.assets[0]).toEqual({
        asset: "USDC",
        totalVolume: "15000.00",
        matchCount: 2,
        uniquePlayers: 3,
        averageWager: "7500.00",
      });
    });

    it("returns HTTP 500 when service layer throws an error", async () => {
      clearVolumeCache();
      supabase.from = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            lte: jest.fn().mockResolvedValue({ data: null, error: new Error("DB Error") }),
          }),
        }),
      });

      const res = await request(app).get("/api/analytics/volume-24h");
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/DB Error/);
    });
  });
});
